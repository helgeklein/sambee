/**
 * Navigation Menu Controller
 * Handles mobile menu toggle and submenu interactions
 */
(function () {
   'use strict';

   const SELECTORS = {
      toggle: '.nav-toggle',
      menu: '.nav-menu',
      submenuToggle: '.nav-submenu-toggle',
      hasChildren: '.has-children'
   };

   const CLASSES = {
      menuOpen: 'nav-menu-open',
      submenuOpen: 'submenu-open',
      active: 'active'
   };

   // Get lg breakpoint from CSS custom property (set in navigation.css)
   // Handles both px and rem values; fallback to 1024px if not defined
   function getBreakpointDesktop() {
      const value = getComputedStyle(document.documentElement)
         .getPropertyValue('--breakpoint-lg')
         .trim();

      if (!value) return 1024;

      // Handle rem values by converting to pixels
      if (value.endsWith('rem')) {
         const remValue = parseFloat(value);
         const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
         return remValue * rootFontSize;
      }

      // Handle px values or raw numbers
      return parseInt(value, 10) || 1024;
   }

   let menuOpen = false;

   /**
    * Measure the header height and set it as a CSS variable
    * so the mobile menu is positioned directly below the header
    */
   function updateHeaderHeight() {
      const header = document.querySelector('.header');
      if (header) {
         const height = header.offsetHeight;
         document.documentElement.style.setProperty('--header-height', `${height}px`);
      }
   }

   function init() {
      const toggle = document.querySelector(SELECTORS.toggle);
      const submenuToggles = document.querySelectorAll(SELECTORS.submenuToggle);

      // Set initial header height
      updateHeaderHeight();

      if (toggle) {
         toggle.addEventListener('click', handleMenuToggle);
      }

      submenuToggles.forEach(btn => {
         btn.addEventListener('click', handleSubmenuToggle);
      });

      // Close menu on resize to desktop
      window.addEventListener('resize', handleResize);

      // Close menu on Escape key
      document.addEventListener('keydown', handleKeydown);
   }

   function handleMenuToggle(e) {
      const toggle = e.currentTarget;
      menuOpen = !menuOpen;

      toggle.classList.toggle(CLASSES.active, menuOpen);
      toggle.setAttribute('aria-expanded', String(menuOpen));
      document.body.classList.toggle(CLASSES.menuOpen, menuOpen);
   }

   function handleSubmenuToggle(e) {
      e.preventDefault();
      e.stopPropagation();

      const btn = e.currentTarget;
      const parent = btn.closest(SELECTORS.hasChildren);

      if (!parent) return;

      const isOpen = parent.classList.contains(CLASSES.submenuOpen);

      // Close siblings at the same level
      const siblings = parent.parentElement.querySelectorAll(':scope > ' + SELECTORS.hasChildren);
      siblings.forEach(sibling => {
         if (sibling !== parent) {
            sibling.classList.remove(CLASSES.submenuOpen);
            const sibBtn = sibling.querySelector(':scope > ' + SELECTORS.submenuToggle);
            if (sibBtn) sibBtn.setAttribute('aria-expanded', 'false');
         }
      });

      // Toggle current
      parent.classList.toggle(CLASSES.submenuOpen, !isOpen);
      btn.setAttribute('aria-expanded', String(!isOpen));
   }

   function handleResize() {
      // Update header height on resize
      updateHeaderHeight();

      const breakpoint = getBreakpointDesktop();
      if (window.innerWidth >= breakpoint && menuOpen) {
         closeMenu();
      }
   }

   function handleKeydown(e) {
      if (e.key === 'Escape' && menuOpen) {
         closeMenu();
         // Return focus to toggle button
         const toggle = document.querySelector(SELECTORS.toggle);
         if (toggle) toggle.focus();
      }
   }

   function closeMenu() {
      const toggle = document.querySelector(SELECTORS.toggle);
      menuOpen = false;

      if (toggle) {
         toggle.classList.remove(CLASSES.active);
         toggle.setAttribute('aria-expanded', 'false');
      }

      document.body.classList.remove(CLASSES.menuOpen);

      // Close all submenus
      document.querySelectorAll('.' + CLASSES.submenuOpen).forEach(el => {
         el.classList.remove(CLASSES.submenuOpen);
         const btn = el.querySelector(':scope > ' + SELECTORS.submenuToggle);
         if (btn) btn.setAttribute('aria-expanded', 'false');
      });
   }

   // Initialize on DOM ready
   if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
   } else {
      init();
   }
})();
