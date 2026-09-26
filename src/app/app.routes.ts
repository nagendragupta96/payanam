import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { LandingComponent } from './pages/landing/landing.component';
import { AuthComponent } from './pages/auth/auth.component';
import { ProfileComponent } from './pages/profile/profile.component';
import { CreateItineraryComponent } from './pages/create-itinerary/create-itinerary.component';
import { SearchComponent } from './pages/search/search.component';
import { ItineraryDetailComponent } from './pages/itinerary-detail/itinerary-detail.component';
import { RequestsInboxComponent } from './pages/requests-inbox/requests-inbox.component';
import { ChatComponent } from './pages/chat/chat.component';
import { SettingsComponent } from './pages/settings/settings.component';
import { MyTripsComponent } from './pages/my-trips/my-trips.component';
import { RequestDetailComponent } from './pages/request-detail/request-detail.component';
import { NotificationsComponent } from './pages/notifications/notifications.component';

export const routes: Routes = [
  { path: '', component: LandingComponent },
  { path: 'home', component: LandingComponent },
  { path: 'auth', component: AuthComponent },
  { path: 'profile', component: ProfileComponent, canActivate: [authGuard] },
  { path: 'create-itinerary', component: CreateItineraryComponent, canActivate: [authGuard] },
  { path: 'edit-itinerary/:id', component: CreateItineraryComponent, canActivate: [authGuard] },
  { path: 'my-trips', component: MyTripsComponent, canActivate: [authGuard] },
  { path: 'search', component: SearchComponent },
  { path: 'itinerary/:id', component: ItineraryDetailComponent },
  { path: 'requests', component: RequestsInboxComponent, canActivate: [authGuard] },
  { path: 'requests/:id', component: RequestDetailComponent, canActivate: [authGuard] },
  { path: 'messages', component: ChatComponent, canActivate: [authGuard] },
  { path: 'messages/:threadId', component: ChatComponent, canActivate: [authGuard] },
  { path: 'chat/:threadId', component: ChatComponent, canActivate: [authGuard] },
  { path: 'notifications', component: NotificationsComponent, canActivate: [authGuard] },
  { path: 'settings', component: SettingsComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' }
];
