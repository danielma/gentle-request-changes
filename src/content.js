"use strict";

const REQUEST_CHANGES_TEXT = /request(?:ed|ing)? changes|changes requested/i;

// Markup GitHub uses today for a "requested changes" review. Matched exactly so
// we never depend on the heuristic below for the common cases.
const KNOWN_ICON_SELECTORS = [
  ".TimelineItem-badge.color-bg-danger-emphasis > svg.octicon-file-diff",
  ".reviewers-status-icon > svg.octicon-file-diff.color-fg-danger",
].join(", ");

// Icons that *might* mean "requested changes" depending on where they appear
// (a red X is also used for failing CI checks, which must stay red).
const CANDIDATE_ICON_SELECTOR = [
  "svg.octicon-x",
  "svg.octicon-x-circle",
  "svg.octicon-x-circle-fill",
  "svg.octicon-file-diff",
].join(", ");

const MAX_CONTEXT_DEPTH = 5;
const MAX_CONTEXT_LENGTH = 300;

const LIGHT_BULB_PATH =
  "M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z";

function isReddish(cssColor) {
  const [r = 0, g = 0, b = 0] = (cssColor.match(/[\d.]+/g) || []).map(Number);
  return r > g + 60 && r > b + 60;
}

function looksRed(svg) {
  const nearby = [svg, svg.parentElement, svg.parentElement && svg.parentElement.parentElement];
  return nearby.some((el) => {
    if (el) {
      const style = getComputedStyle(el);
      return isReddish(style.color) || isReddish(style.backgroundColor);
    } else {
      return false;
    }
  });
}

function accessibleText(el) {
  const labelledBy = (el.getAttribute("aria-labelledby") || "")
    .split(/\s+/)
    .map((id) => document.getElementById(id))
    .filter(Boolean)
    .map((label) => label.textContent);

  return [el.getAttribute("aria-label"), el.getAttribute("title"), ...labelledBy, el.textContent].join(" ");
}

// The smallest nearby ancestor that talks about requested changes must be
// short (a status row, not the whole merge box) and must own only this one
// red icon — otherwise a failing-CI X sitting next to a "Changes requested"
// header would get recolored too.
function describesRequestedChanges(svg) {
  let el = svg.parentElement;
  let verdict = false;
  let decided = false;

  for (let depth = 0; depth < MAX_CONTEXT_DEPTH && el && !decided; depth++) {
    const text = accessibleText(el);
    if (REQUEST_CHANGES_TEXT.test(text)) {
      const redIcons = [...el.querySelectorAll(CANDIDATE_ICON_SELECTOR)].filter(
        (icon) => icon.hasAttribute("data-grc-icon") || looksRed(icon),
      );
      verdict = text.length <= MAX_CONTEXT_LENGTH && redIcons.length === 1;
      decided = true;
    } else {
      el = el.parentElement;
    }
  }

  return verdict;
}

function findRedBadge(svg) {
  const ancestors = [svg.parentElement, svg.parentElement && svg.parentElement.parentElement];
  return ancestors.find((el) => el && isReddish(getComputedStyle(el).backgroundColor));
}

// Only attributes are touched (never adding or removing nodes) so GitHub's
// React views can keep reconciling the same DOM they rendered.
function soften(svg) {
  const badge = findRedBadge(svg);
  badge && badge.setAttribute("data-grc-badge", "");

  const [firstPath, ...otherPaths] = svg.querySelectorAll("path");
  if (firstPath) {
    firstPath.setAttribute("d", LIGHT_BULB_PATH);
    otherPaths.forEach((path) => path.setAttribute("display", "none"));
    svg.setAttribute("viewBox", "0 0 16 16");
  }

  svg.setAttribute("data-grc-icon", "");
}

function softenRequestChangesIcons() {
  document.querySelectorAll(KNOWN_ICON_SELECTORS).forEach((svg) => {
    svg.hasAttribute("data-grc-icon") || soften(svg);
  });

  document.querySelectorAll(CANDIDATE_ICON_SELECTOR).forEach((svg) => {
    const isUnsoftenedRequestChanges =
      !svg.hasAttribute("data-grc-icon") && looksRed(svg) && describesRequestedChanges(svg);
    isUnsoftenedRequestChanges && soften(svg);
  });
}

let scheduled = false;

function scheduleApply() {
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      softenRequestChangesIcons();
    });
  }
}

// Observe <html> rather than <body>: Turbo navigation swaps out <body>.
new MutationObserver(scheduleApply).observe(document.documentElement, { childList: true, subtree: true });
scheduleApply();
