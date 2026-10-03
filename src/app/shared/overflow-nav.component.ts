import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Input, NgZone, OnChanges, OnDestroy, Output, ViewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

interface NavItem { path: string; label: string; count?: number; profile?: boolean; logout?: boolean; }

@Component({
  selector: 'app-overflow-nav',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './overflow-nav.component.html',
  styleUrl: './overflow-nav.component.css'
})
export class OverflowNavComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() loggedIn = false;
  @Input() isAdmin = false;
  @Input() currentUrl = '/';
  @Input() avatarUrl = '';
  @Input() requestCount = 0;
  @Input() messageCount = 0;
  @Input() notificationCount = 0;
  @Output() logout = new EventEmitter<void>();
  @Output() avatarError = new EventEmitter<void>();
  @ViewChild('available') available?: ElementRef<HTMLElement>;
  @ViewChild('measure') measure?: ElementRef<HTMLElement>;
  @ViewChild('moreMeasure') moreMeasure?: ElementRef<HTMLElement>;
  @ViewChild('moreButton') moreButton?: ElementRef<HTMLButtonElement>;
  items: NavItem[] = [];
  visibleCount = 0;
  open = false;
  private observer?: ResizeObserver;
  private frame: number | null = null;
  private destroyed = false;

  constructor(private host: ElementRef<HTMLElement>, private zone: NgZone) {}

  get visibleItems(): NavItem[] { return this.items.slice(0, this.visibleCount); }
  get overflowItems(): NavItem[] { return this.items.slice(this.visibleCount); }
  get overflowUnread(): number { return this.overflowItems.reduce((sum, item) => sum + (item.count ?? 0), 0); }
  get overflowActive(): boolean { return this.overflowItems.some(item => this.active(item)); }

  ngOnChanges(): void {
    this.items = [
      { path: '/home', label: 'Home' }, { path: '/search', label: 'Search' },
      ...(this.loggedIn ? [
        { path: '/create-itinerary', label: 'Post Trip' },
        { path: '/my-trips', label: 'My Trips' },
        { path: '/community', label: 'Community' },
        { path: '/requests', label: 'Requests', count: this.requestCount },
        { path: '/messages', label: 'Messages', count: this.messageCount },
        { path: '/notifications', label: 'Notifications', count: this.notificationCount },
        { path: '/activity', label: 'My Activity' },
        { path: '/subscription', label: 'Subscription' },
        ...(this.isAdmin ? [{ path: '/admin', label: 'Admin' }] : []),
        { path: '/profile', label: 'Profile', profile: true },
        { path: '', label: 'Logout', logout: true }
      ] : [{ path: '/auth', label: 'Login' }])
    ];
    this.open = false;
    this.scheduleMeasure();
  }

  ngAfterViewInit(): void {
    this.observer = new ResizeObserver(() => this.scheduleMeasure());
    this.observer.observe(this.available!.nativeElement);
    this.observer.observe(this.measure!.nativeElement);
    void document.fonts.ready.then(() => { if (!this.destroyed) this.scheduleMeasure(); });
    this.scheduleMeasure();
  }

  active(item: NavItem): boolean {
    if (item.logout) return false;
    const url = this.currentUrl.split(/[?#]/)[0];
    return url === item.path || url.startsWith(item.path + '/')
      || (item.path === '/home' && url === '/')
      || (item.path === '/messages' && url.startsWith('/chat'))
      || (item.path === '/create-itinerary' && url.startsWith('/edit-itinerary/'));
  }

  close(): void { this.open = false; }
  signOut(): void { this.close(); this.logout.emit(); }

  @HostListener('document:click', ['$event'])
  onOutsideClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  @HostListener('keydown.escape')
  onEscape(): void {
    if (this.open) { this.close(); this.moreButton?.nativeElement.focus(); }
  }

  private scheduleMeasure(): void {
    if (this.frame !== null || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (!this.available || !this.measure || !this.moreMeasure) return;
      const widths = Array.from(this.measure.nativeElement.children).map(item => item.getBoundingClientRect().width);
      const gap = 4;
      const room = this.available.nativeElement.clientWidth;
      const total = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);
      let count = widths.length;
      if (total > room) {
        const limit = Math.max(0, room - this.moreMeasure.nativeElement.getBoundingClientRect().width - gap);
        let used = 0;
        count = 0;
        for (const width of widths) {
          const next = used + (count ? gap : 0) + width;
          if (next > limit) break;
          used = next;
          count++;
        }
      }
      if (count !== this.visibleCount) this.zone.run(() => { this.visibleCount = count; this.close(); });
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
  }
}
