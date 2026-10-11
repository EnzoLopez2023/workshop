/**
 * Bring a group of settings to the top of the builder's settings column and flash it.
 * On a desktop the column scrolls on its own, so only it moves (scrollIntoView would also
 * scroll the page and push the toolbar away); on a phone, where the page scrolls, the page does.
 */
export function scrollToSetting(el: HTMLElement): void {
  const behavior: ScrollBehavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const column = el.closest<HTMLElement>('.shelf-config');
  const nav = column?.querySelector<HTMLElement>('.builder-step-nav');
  const offset = (nav?.getBoundingClientRect().height ?? 0) + 10;
  if (column && column.scrollHeight > column.clientHeight + 1 && getComputedStyle(column).overflowY !== 'visible') {
    column.scrollTo({ top: column.scrollTop + el.getBoundingClientRect().top - column.getBoundingClientRect().top - offset, behavior });
  } else {
    window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - offset - 64, behavior });
  }
  el.classList.remove('is-flash');
  void el.offsetWidth;
  el.classList.add('is-flash');
}
