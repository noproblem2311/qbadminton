import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Load a Facebook fixture into the jsdom document (Vitest runs from the extension root). */
export function loadFacebookFixture(name = 'facebook-group.html'): void {
  const html = readFileSync(join(process.cwd(), 'tests', 'fixtures', name), 'utf8');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.title = parsed.title;
  document.body.innerHTML = parsed.body.innerHTML;
}

export function feedChildren(): HTMLElement[] {
  return Array.from(document.querySelector('[role="feed"]')!.children) as HTMLElement[];
}

/** A minimal Facebook-like feed item, as appended by infinite scroll or a refresh. */
export function buildPost(options: { author: string; text: string; postId?: string }): HTMLElement {
  const item = document.createElement('div');
  item.className = 'x1n2onr6 xh8yej3 x1ja2u2z xod5an3';
  const link = options.postId
    ? `<a href="https://www.facebook.com/groups/caulongdanang/posts/${options.postId}/?__cft__[0]=X" aria-label="Vừa xong"><span>Vừa xong</span></a>`
    : '';
  item.innerHTML = `
    <div data-virtualized="false"><div aria-posinset="9">
      <h2><span><a href="https://www.facebook.com/groups/caulongdanang/user/1/"><span>${options.author}</span></a></span></h2>
      ${link}
      <div data-ad-preview="message"><div dir="auto">${options.text}</div></div>
      <div role="button" tabindex="0"><span>Thích</span></div>
    </div></div>`;
  return item;
}
