import { CreateView } from './views/create-view';
import { GardenView } from './views/garden-view';
import { AdminView } from './views/admin-view';

class AppRouter {
  private appElement: HTMLElement;
  private currentView: { destroy?: () => void } | null = null;

  constructor() {
    const el = document.getElementById('app');
    if (!el) throw new Error('Missing #app root element');
    this.appElement = el;

    window.addEventListener('popstate', () => this.handleRoute());
    window.addEventListener('hashchange', () => this.handleRoute());
    this.handleRoute();
  }

  public navigate(path: string): void {
    // Determine if we should navigate via hash or pushState
    const cleanRoute = path.replace(/^\/?#?\/?/, '');
    if (window.location.hash || window.location.pathname.includes('.html')) {
      window.location.hash = `/${cleanRoute}`;
    } else {
      window.history.pushState({}, '', path);
      this.handleRoute();
    }
  }

  private handleRoute(): void {
    const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0];
    const pathname = window.location.pathname.split('?')[0];

    if (this.currentView && typeof this.currentView.destroy === 'function') {
      this.currentView.destroy();
      this.currentView = null;
    }

    this.appElement.innerHTML = '';

    // Route resolution supporting root, subpath (e.g. /VirtualGarden/...), and hash (#/...)
    let matched = 'garden';
    if (hash === 'create' || pathname.endsWith('/create')) {
      matched = 'create';
    } else if (hash === 'admin' || pathname.endsWith('/admin')) {
      matched = 'admin';
    } else if (hash === 'garden' || pathname.endsWith('/garden')) {
      matched = 'garden';
    } else if (pathname === '/' || pathname.endsWith('/')) {
      matched = 'garden';
    }

    if (matched === 'create') {
      document.title = 'Plant a Flower — The Living Garden';
      this.currentView = new CreateView(this.appElement);
    } else if (matched === 'admin') {
      document.title = 'Installation Admin — The Living Garden';
      this.currentView = new AdminView(this.appElement);
    } else {
      document.title = 'The Living Garden — Gallery Exhibition';
      this.currentView = new GardenView(this.appElement);
    }
  }
}

// Global click interceptor for SPA navigation
document.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest('a');
  if (
    target &&
    target.href &&
    target.origin === window.location.origin &&
    !target.hasAttribute('download') &&
    target.target !== '_blank'
  ) {
    const path = target.getAttribute('href') || target.pathname;
    if (path.includes('create') || path.includes('garden') || path.includes('admin')) {
      e.preventDefault();
      router.navigate(path);
    }
  }
});

const router = new AppRouter();
export { router };

