import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  isNavOpen = false;

  constructor(public authService: AuthService) {}

  get isLoggedIn(): boolean {
    return !!this.authService.currentSession;
  }

  closeNav() {
    this.isNavOpen = false;
  }
}
