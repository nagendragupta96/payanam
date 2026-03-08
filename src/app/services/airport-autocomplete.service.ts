import { Injectable } from '@angular/core';

export interface AirportEntry {
  code: string;
  name: string;
  city: string;
  country: string;
}

@Injectable({ providedIn: 'root' })
export class AirportAutocompleteService {
  private airports: AirportEntry[] = [];
  private loadPromise: Promise<void> | null = null;

  private async ensureLoaded(): Promise<void> {
    if (this.airports.length) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      const response = await fetch('/assets/airports-iata.json');
      if (!response.ok) {
        throw new Error('Unable to load airport data.');
      }
      this.airports = (await response.json()) as AirportEntry[];
    })();

    return this.loadPromise;
  }

  async search(query: string, limit = 20): Promise<AirportEntry[]> {
    await this.ensureLoaded();
    const needle = (query || '').trim().toLowerCase();
    if (!needle) return this.airports.slice(0, limit);

    const scored = this.airports
      .map((airport) => {
        const code = airport.code.toLowerCase();
        const name = airport.name.toLowerCase();
        const city = airport.city.toLowerCase();
        const country = airport.country.toLowerCase();

        let score = 0;
        if (code === needle) score += 100;
        else if (code.startsWith(needle)) score += 80;
        else if (code.includes(needle)) score += 40;

        if (city.startsWith(needle)) score += 60;
        else if (city.includes(needle)) score += 30;

        if (country.startsWith(needle)) score += 50;
        else if (country.includes(needle)) score += 20;

        if (name.startsWith(needle)) score += 40;
        else if (name.includes(needle)) score += 15;

        return { airport, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.airport);

    return scored;
  }

  optionLabel(airport: AirportEntry): string {
    return `${airport.code} — ${airport.city}, ${airport.country} (${airport.name})`;
  }
}
