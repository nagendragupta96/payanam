import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="hero-wrapper text-white rounded-4 p-4 p-md-5 shadow-lg overflow-hidden position-relative">
      <div class="hero-overlay"></div>
      <div class="position-relative hero-content col-lg-8">
        <h1 class="display-3 fw-bold mb-3">Payanam</h1>
        <p class="lead mb-3">A safe travel companion platform for shared journeys and assisted airport connections.</p>

        <ul class="lead ps-3 mb-4">
          <li>Helps travelers find compatible travel companions.</li>
          <li>Helps elderly travelers get assistance during airport connections.</li>
          <li>Matches itineraries based on route and dates.</li>
          <li>Enables safe in-app communication after approval.</li>
        </ul>

        <div class="d-flex flex-wrap gap-2 mt-4">
          <a routerLink="/search" class="btn btn-primary btn-lg">Find matching trips</a>
          <a routerLink="/create-itinerary" class="btn btn-outline-light btn-lg">Post your itinerary</a>
          <a *ngIf="!isLoggedIn" routerLink="/auth" class="btn btn-warning btn-lg">Sign In / Login</a>
        </div>
      </div>
    </section>
  `,
  styleUrl: './landing.component.css'
})
export class LandingComponent {
  constructor(private authService: AuthService) {}

  get isLoggedIn(): boolean {
    return !!this.authService.currentSession;
  }
}
