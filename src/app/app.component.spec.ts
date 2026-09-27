import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { AuthService } from './services/auth.service';
import { AdminService } from './services/admin.service';
import { ActivityService } from './services/activity.service';
import { NotificationService } from './services/notification.service';
import { MessageNotificationService } from './services/message-notification.service';
import { RequestNotificationService } from './services/request-notification.service';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { currentSession: null, session$: new BehaviorSubject(null), authError$: new Subject(), ensureInitialized: async () => undefined } },
        { provide: AdminService, useValue: { isAdmin: false } },
        { provide: ActivityService, useValue: {} },
        { provide: NotificationService, useValue: { unreadCount: 0 } },
        { provide: MessageNotificationService, useValue: { unreadCount: 0 } },
        { provide: RequestNotificationService, useValue: { unreadRequestCount: 0 } }
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should default currentUrl to root', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.currentUrl).toEqual('/');
  });

  it('should report section activity using prefix matching', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    app.currentUrl = '/chat/123';
    expect(app.isSectionActive('/chat')).toBeTrue();
    expect(app.isSectionActive('/messages')).toBeFalse();
  });
});
