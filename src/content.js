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

const SETTINGS_DEFAULTS = { hideCommentOption: false };
let settings = { ...SETTINGS_DEFAULTS };

function labelText(input) {
  const label = input.labels && input.labels[0];
  const text = label ? label.textContent : input.getAttribute("aria-label") || "";
  return text.trim();
}

function radioGroup(input) {
  const scope = input.closest('fieldset, [role="radiogroup"], form, [role="dialog"]') || document;
  const radios = [...scope.querySelectorAll('input[type="radio"]')];
  return input.name ? radios.filter((radio) => radio.name === input.name) : radios;
}

// Works for both the classic form (value="comment" / "reject") and the React
// review dialog, which we can only recognize by its labels.
function isCommentReviewOption(input) {
  const isComment = /^comment$/i.test(input.value) || /^comment\b/i.test(labelText(input));
  const isReviewGroup = radioGroup(input).some(
    (radio) => /^(reject|request_changes)$/i.test(radio.value) || REQUEST_CHANGES_TEXT.test(labelText(radio)),
  );
  return isComment && isReviewGroup;
}

// The largest wrapper that holds this radio and no sibling option, so the
// description text and spacing disappear along with the input.
function optionContainer(input) {
  let container = input;
  while (container.parentElement && container.parentElement.querySelectorAll('input[type="radio"]').length === 1) {
    container = container.parentElement;
  }
  return container;
}

function applyCommentVisibility() {
  document.querySelectorAll('input[type="radio"]').forEach((input) => {
    if (isCommentReviewOption(input)) {
      input.setAttribute("data-grc-comment-option", "");
      optionContainer(input).toggleAttribute("data-grc-hidden", settings.hideCommentOption);
    }
  });
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "grc-toast";
  toast.setAttribute("role", "alert");
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function isSubmitControl(target) {
  const control = target.closest('button, input[type="submit"]');
  // Read the attribute, not `control.type`: buttons with no type report "submit".
  return Boolean(control) && (control.getAttribute("type") === "submit" || /submit review/i.test(control.textContent));
}

// GitHub's classic form pre-selects "Comment". With it hidden, submitting
// would silently post a comment-only review, so stop and ask for a choice.
function guardHiddenCommentSubmit(event) {
  const scope = event.target instanceof Element && event.target.closest('form, [role="dialog"]');
  const isSubmitAttempt = event.type === "submit" || (event.target instanceof Element && isSubmitControl(event.target));
  const hiddenCommentChosen =
    Boolean(scope) && Boolean(scope.querySelector("input[data-grc-comment-option]:checked"));

  if (settings.hideCommentOption && isSubmitAttempt && hiddenCommentChosen) {
    event.preventDefault();
    event.stopImmediatePropagation();
    showToast("Choose “Approve” or “Request changes” before submitting your review.");
  }
}

document.addEventListener("click", guardHiddenCommentSubmit, true);
document.addEventListener("submit", guardHiddenCommentSubmit, true);

chrome.storage.sync.get(SETTINGS_DEFAULTS, (stored) => {
  settings = stored;
  applyCommentVisibility();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.hideCommentOption) {
    settings = { ...settings, hideCommentOption: changes.hideCommentOption.newValue };
    applyCommentVisibility();
  }
});

let scheduled = false;

function scheduleApply() {
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      softenRequestChangesIcons();
      applyCommentVisibility();
    });
  }
}

// Observe <html> rather than <body>: Turbo navigation swaps out <body>.
new MutationObserver(scheduleApply).observe(document.documentElement, { childList: true, subtree: true });
scheduleApply();
