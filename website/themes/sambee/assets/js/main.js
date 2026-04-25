/* Purpose: Provides a shared entry point for lightweight site-wide JavaScript. */
(function () {
   "use strict";

   const COPY_BUTTON_SELECTOR = '.content pre, .content .highlight';
   const COPY_BUTTON_CLASS = 'code-copy-btn';

   function createCopyButton() {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = COPY_BUTTON_CLASS;
      button.setAttribute('aria-label', 'Copy code');
      button.innerHTML = '<span class="icon-copy">Copy</span><span class="icon-check">Copied</span>';
      return button;
   }

   async function copyCode(button, codeElement) {
      const code = codeElement ? codeElement.innerText : '';
      if (!code) {
         return;
      }

      try {
         await navigator.clipboard.writeText(code);
         button.classList.add('copied');
         window.setTimeout(() => button.classList.remove('copied'), 1600);
      } catch (_error) {
         button.classList.remove('copied');
      }
   }

   function initCodeCopyButtons() {
      document.querySelectorAll(COPY_BUTTON_SELECTOR).forEach((block) => {
         if (block.querySelector('.' + COPY_BUTTON_CLASS)) {
            return;
         }

         const codeElement = block.querySelector('code') || block;
         const button = createCopyButton();
         button.addEventListener('click', () => copyCode(button, codeElement));
         block.appendChild(button);
      });
   }

   if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initCodeCopyButtons);
   } else {
      initCodeCopyButtons();
   }
})();
