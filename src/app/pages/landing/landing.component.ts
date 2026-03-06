import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="hero-wrapper text-white rounded-4 p-4 p-md-5 shadow-lg overflow-hidden position-relative">
      <div class="hero-overlay"></div>
      <div class="position-relative hero-content col-lg-7">
        <span class="badge rounded-pill text-bg-info mb-3">Global Travel Companion</span>
        <h1 class="display-5 fw-bold">Travel safer together, from first leg to final destination.</h1>
        <p class="lead text-light-emphasis">
          Create multi-leg itineraries, discover overlapping journeys, request assistance,
          and unlock realtime chat only after a request is accepted.
        </p>

        <div class="d-flex flex-wrap gap-2 mt-4">
          <a routerLink="/search" class="btn btn-primary btn-lg">Find matching trips</a>
          <a routerLink="/create-itinerary" class="btn btn-outline-light btn-lg">Post your itinerary</a>
        </div>

        <ul class="nav nav-tabs mt-4 border-0">
          <li class="nav-item"><span class="nav-link active bg-white text-dark">Companion matching</span></li>
          <li class="nav-item"><span class="nav-link text-white-50">Assisted travel</span></li>
          <li class="nav-item"><span class="nav-link text-white-50">Realtime chat safety</span></li>
        </ul>
      </div>
    </section>
  `,
  styleUrl: './landing.component.css'
})
export class LandingComponent {}
