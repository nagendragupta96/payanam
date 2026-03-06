import { Component } from '@angular/core';

@Component({
  selector: 'app-settings',
  standalone: true,
  template: `
    <h2>Settings</h2>
    <p>Subscription management placeholder for future Stripe/Supabase billing integration.</p>
    <ul>
      <li>Free plan: basic search and requests</li>
      <li>Plus plan: priority matching and advanced filters</li>
    </ul>
  `
})
export class SettingsComponent {}
