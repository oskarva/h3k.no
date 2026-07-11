(function () {
  "use strict";

  var COMPACT_AT = 64;
  var EXPAND_AT = 24;
  var MIN_CANDLE_REMAINING = 0.15;

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
      return;
    }

    callback();
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function currentScrollY() {
    return window.scrollY || document.documentElement.scrollTop || 0;
  }

  function initHeader() {
    var header = document.querySelector("[data-site-header]");

    if (!header) {
      return;
    }

    var compact = header.classList.contains("is-compact");
    var scrollFrame = 0;
    var heightFrame = 0;

    function updateHeaderHeight() {
      heightFrame = 0;
      var height = Math.ceil(header.getBoundingClientRect().height);

      if (height > 0) {
        document.documentElement.style.setProperty("--header-height", height + "px");
      }
    }

    function queueHeightUpdate() {
      if (!heightFrame) {
        heightFrame = window.requestAnimationFrame(updateHeaderHeight);
      }
    }

    function updateHeaderState(forceRestoredState) {
      var scrollTop = currentScrollY();
      var nextCompact = compact;

      if (forceRestoredState) {
        nextCompact = scrollTop > COMPACT_AT;
      } else if (scrollTop > COMPACT_AT) {
        nextCompact = true;
      } else if (scrollTop < EXPAND_AT) {
        nextCompact = false;
      }

      if (nextCompact !== compact || forceRestoredState) {
        compact = nextCompact;
        header.classList.toggle("is-compact", compact);
        queueHeightUpdate();
      }
    }

    function onScroll() {
      if (!scrollFrame) {
        scrollFrame = window.requestAnimationFrame(function () {
          scrollFrame = 0;
          updateHeaderState(false);
        });
      }
    }

    updateHeaderState(true);
    queueHeightUpdate();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", queueHeightUpdate, { passive: true });
    window.addEventListener("load", queueHeightUpdate, { once: true });
    window.addEventListener("pageshow", function () {
      updateHeaderState(true);
      queueHeightUpdate();
    });

    if (typeof window.ResizeObserver === "function") {
      var headerObserver = new ResizeObserver(queueHeightUpdate);
      headerObserver.observe(header);
    } else {
      header.addEventListener("transitionend", queueHeightUpdate);
    }
  }

  function initProductCards() {
    var cards = Array.prototype.slice.call(document.querySelectorAll(".product-card"));

    if (!cards.length) {
      return;
    }

    var pointerTypes = new WeakMap();
    var revealedCard = null;

    function hideCard(card) {
      if (!card) {
        return;
      }

      card.classList.remove("is-revealed");

      if (revealedCard === card) {
        revealedCard = null;
      }
    }

    function revealCard(card) {
      if (revealedCard && revealedCard !== card) {
        hideCard(revealedCard);
      }

      card.classList.add("is-revealed");
      revealedCard = card;
    }

    function closestLink(element, card) {
      if (card.matches("a[href]")) {
        return card;
      }

      if (element && typeof element.closest === "function") {
        var clickedLink = element.closest("a[href]");

        if (clickedLink && card.contains(clickedLink)) {
          return clickedLink;
        }
      }

      return card.querySelector("a[href]");
    }

    function navigateIfNeeded(card, target) {
      var link = closestLink(target, card);

      if (!link || link === target || (target && typeof target.closest === "function" && target.closest("a[href]") === link)) {
        return;
      }

      var destination = link.getAttribute("href");

      if (destination) {
        window.location.assign(destination);
      }
    }

    cards.forEach(function (card) {
      card.addEventListener("pointerdown", function (event) {
        pointerTypes.set(card, event.pointerType);
      });

      if (typeof window.PointerEvent !== "function") {
        card.addEventListener("touchstart", function () {
          pointerTypes.set(card, "touch");
        }, { passive: true });
      }

      card.addEventListener("click", function (event) {
        var pointerType = pointerTypes.get(card);
        pointerTypes.delete(card);

        // Keyboard and assistive-technology activation must remain a direct link.
        if (event.detail === 0) {
          navigateIfNeeded(card, event.target);
          return;
        }

        if (pointerType !== "touch") {
          navigateIfNeeded(card, event.target);
          return;
        }

        if (!card.classList.contains("is-revealed")) {
          event.preventDefault();
          revealCard(card);
          return;
        }

        // A second touch follows the native link (or the card's internal link).
        navigateIfNeeded(card, event.target);
      });
    });

    function closeFromOutsideTouch(event) {
      var target = event.target;

      if (revealedCard && (!target || !revealedCard.contains(target))) {
        hideCard(revealedCard);
      }
    }

    document.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "touch") {
        closeFromOutsideTouch(event);
      }
    }, { passive: true });

    if (typeof window.PointerEvent !== "function") {
      document.addEventListener("touchstart", closeFromOutsideTouch, { passive: true });
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && revealedCard) {
        hideCard(revealedCard);
      }
    });
  }

  function numberAttribute(element, name) {
    var value = parseFloat(element.getAttribute(name));
    return Number.isFinite(value) ? value : null;
  }

  function svgNumber(value) {
    return value.toFixed(3).replace(/\.?0+$/, "");
  }

  function createCandleController(section, reducedMotionQuery) {
    var body = section.querySelector("[data-candle-body]");
    var top = section.querySelector("[data-candle-top]");
    var sticky = section.querySelector("[data-candle-sticky]");

    if (!body || !top || !sticky) {
      return null;
    }

    var originalY = body.getAttribute("y");
    var originalHeight = body.getAttribute("height");
    var fullY = numberAttribute(body, "y");
    var fullHeight = numberAttribute(body, "height");
    var originalTopTransform = top.getAttribute("transform");
    var stickyOffsetWithinSection = 0;
    var graphicHeight = 0;

    if (fullY === null || fullHeight === null || fullHeight <= 0) {
      return null;
    }

    function measure() {
      var inlinePosition = sticky.style.position;

      // A stuck element's offsetTop is its current, not its natural, position.
      // Measuring one layout pass as static gives a stable start point even when
      // the browser restores the page halfway down the history section.
      sticky.style.position = "static";
      var naturalStickyTop = currentScrollY() + sticky.getBoundingClientRect().top;
      sticky.style.position = inlinePosition;

      var sectionRect = section.getBoundingClientRect();
      var sectionTop = currentScrollY() + sectionRect.top;
      stickyOffsetWithinSection = naturalStickyTop - sectionTop;
      graphicHeight = sticky.getBoundingClientRect().height;
    }

    function reset() {
      body.setAttribute("y", originalY);
      body.setAttribute("height", originalHeight);

      if (originalTopTransform === null) {
        top.removeAttribute("transform");
      } else {
        top.setAttribute("transform", originalTopTransform);
      }

      section.style.setProperty("--candle-progress", "0");
    }

    function render() {
      if (reducedMotionQuery && reducedMotionQuery.matches) {
        reset();
        return;
      }

      var stickyTop = parseFloat(window.getComputedStyle(sticky).top);
      var resolvedStickyTop = Number.isFinite(stickyTop) ? stickyTop : 0;
      var sectionTop = currentScrollY() + section.getBoundingClientRect().top;
      var stickyNaturalTop = sectionTop + stickyOffsetWithinSection;
      var sectionBottom = sectionTop + section.offsetHeight;
      var startScroll = stickyNaturalTop - resolvedStickyTop;
      var stickyReleaseScroll = sectionBottom - resolvedStickyTop - graphicHeight;
      var sectionExitScroll = sectionBottom - window.innerHeight;
      var endScroll = Math.min(stickyReleaseScroll, sectionExitScroll);
      var scrollSpan = Math.max(1, endScroll - startScroll);
      var progress = clamp((currentScrollY() - startScroll) / scrollSpan, 0, 1);
      var remaining = 1 - progress * (1 - MIN_CANDLE_REMAINING);
      var visibleHeight = fullHeight * remaining;
      var burnedHeight = fullHeight - visibleHeight;
      var shiftedY = fullY + burnedHeight;
      var shiftTransform = "translate(0 " + svgNumber(burnedHeight) + ")";

      body.setAttribute("y", svgNumber(shiftedY));
      body.setAttribute("height", svgNumber(visibleHeight));
      top.setAttribute(
        "transform",
        originalTopTransform ? originalTopTransform + " " + shiftTransform : shiftTransform
      );
      section.style.setProperty("--candle-progress", progress.toFixed(4));
    }

    measure();

    return {
      measure: measure,
      render: render,
      section: section,
      sticky: sticky
    };
  }

  function initCandleHistories() {
    var sections = Array.prototype.slice.call(document.querySelectorAll("[data-candle-history]"));

    if (!sections.length) {
      return;
    }

    var reducedMotionQuery = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    var controllers = sections.map(function (section) {
      return createCandleController(section, reducedMotionQuery);
    }).filter(Boolean);

    if (!controllers.length) {
      return;
    }

    var renderFrame = 0;

    function renderAll() {
      renderFrame = 0;
      controllers.forEach(function (controller) {
        controller.render();
      });
    }

    function queueRender() {
      if (!renderFrame) {
        renderFrame = window.requestAnimationFrame(renderAll);
      }
    }

    function measureAndRender() {
      controllers.forEach(function (controller) {
        controller.measure();
      });
      queueRender();
    }

    queueRender();
    window.addEventListener("scroll", queueRender, { passive: true });
    window.addEventListener("resize", measureAndRender, { passive: true });
    window.addEventListener("load", measureAndRender, { once: true });
    window.addEventListener("pageshow", measureAndRender);

    if (typeof window.ResizeObserver === "function") {
      var historyObserver = new ResizeObserver(measureAndRender);
      controllers.forEach(function (controller) {
        historyObserver.observe(controller.section);
        historyObserver.observe(controller.sticky);
      });
    }

    if (reducedMotionQuery) {
      if (typeof reducedMotionQuery.addEventListener === "function") {
        reducedMotionQuery.addEventListener("change", queueRender);
      } else if (typeof reducedMotionQuery.addListener === "function") {
        reducedMotionQuery.addListener(queueRender);
      }
    }

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(measureAndRender);
    }
  }

  onReady(function () {
    initHeader();
    initProductCards();
    initCandleHistories();
  });
})();
