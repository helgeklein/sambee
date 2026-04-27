/* Purpose: Provides a shared entry point for lightweight site-wide JavaScript. */
(function () {
   "use strict";

   const COPY_BUTTON_SELECTOR = '.content pre, .content .highlight';
   const COPY_BUTTON_CLASS = 'code-copy-btn';
   const DOCS_VERSION_DROPDOWN_SELECTOR = '.docs-sidebar-version-control';
   const DOCS_VERSION_DROPDOWN_CLOSE_SELECTOR = '[data-close-version-dropdown]';
   const DOCS_SIDEBAR_TOGGLE_SELECTOR = '.docs-sidebar-toggle';
   const COPY_FEEDBACK_TIMEOUT_MS = 1600;

   function getCopyIconMarkup(iconName, label) {
      return '<span class="material-symbols-outlined" aria-hidden="true">' + iconName + '</span><span class="visually-hidden">' + label + '</span>';
   }

   function createCopyButton() {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = COPY_BUTTON_CLASS;
      button.setAttribute('aria-label', 'Copy code');
      button.innerHTML = '<span class="icon-copy">' + getCopyIconMarkup('content_copy', 'Copy code') + '</span><span class="icon-check">' + getCopyIconMarkup('check', 'Copied') + '</span>';
      return button;
   }

   function getCodeText(codeElement) {
      if (!codeElement) {
         return '';
      }

      const chromaLines = codeElement.querySelectorAll('.cl');

      if (chromaLines.length) {
         return Array.from(chromaLines, (line) => line.textContent || '').join('').replace(/\n$/, '');
      }

      return (codeElement.textContent || '').replace(/\n$/, '');
   }

   async function copyCode(button, codeElement) {
      const code = getCodeText(codeElement);

      if (!code) {
         return;
      }

      try {
         await navigator.clipboard.writeText(code);
         button.classList.add('copied');
         window.setTimeout(() => button.classList.remove('copied'), COPY_FEEDBACK_TIMEOUT_MS);
      } catch (_error) {
         button.classList.remove('copied');
      }
   }

   function initCodeCopyButtons() {
      document.querySelectorAll(COPY_BUTTON_SELECTOR).forEach((block) => {
         if (block.tagName === 'PRE' && block.parentElement && block.parentElement.classList.contains('highlight')) {
            return;
         }

         if (block.querySelector('.' + COPY_BUTTON_CLASS)) {
            return;
         }

         const codeElement = block.querySelector('code') || block;
         const button = createCopyButton();
         button.addEventListener('click', () => copyCode(button, codeElement));
         block.appendChild(button);
      });
   }

    function initDocsVersionDropdowns() {
      const dropdowns = document.querySelectorAll(DOCS_VERSION_DROPDOWN_SELECTOR);

      if (!dropdowns.length) {
         return;
      }

      document.querySelectorAll(DOCS_VERSION_DROPDOWN_CLOSE_SELECTOR).forEach((button) => {
         button.addEventListener('click', () => {
            const dropdown = button.closest(DOCS_VERSION_DROPDOWN_SELECTOR);

            if (dropdown) {
               dropdown.open = false;
            }
         });
      });

      document.addEventListener('click', (event) => {
         dropdowns.forEach((dropdown) => {
            if (dropdown.open && !dropdown.contains(event.target)) {
               dropdown.open = false;
            }
         });
      });

      document.addEventListener('keydown', (event) => {
         if (event.key !== 'Escape') {
            return;
         }

         dropdowns.forEach((dropdown) => {
            if (dropdown.open) {
               dropdown.open = false;
            }
         });
      });
   }

   function initDocsSidebarToggles() {
      document.querySelectorAll(DOCS_SIDEBAR_TOGGLE_SELECTOR).forEach((button) => {
         button.addEventListener('click', () => {
            const targetId = button.getAttribute('aria-controls');

            if (!targetId) {
               return;
            }

            const container = document.getElementById(targetId);

            if (!container) {
               return;
            }

            const isExpanded = button.getAttribute('aria-expanded') === 'true';
            button.setAttribute('aria-expanded', String(!isExpanded));
            container.hidden = isExpanded;
         });
      });
   }

   function init() {
      initCodeCopyButtons();
      initDocsVersionDropdowns();
      initDocsSidebarToggles();
   }

   if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
   } else {
      init();
   }
})();
