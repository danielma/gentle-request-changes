"use strict";

const checkbox = document.getElementById("hide-comment-option");

chrome.storage.sync.get({ hideCommentOption: false }, ({ hideCommentOption }) => {
  checkbox.checked = hideCommentOption;
});

checkbox.addEventListener("change", () => {
  chrome.storage.sync.set({ hideCommentOption: checkbox.checked });
});
