import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { combineLatest, Subscription } from 'rxjs';
import { LucideAngularModule, Plus, RefreshCw, MessageCircle, Share2, Flag, Pencil, Trash2 } from 'lucide-angular';
import { COMMUNITY_CATEGORIES, COMMUNITY_UPDATE_NOTICE, CommunityFilters, CommunityPost, Reaction } from '../../models/community.model';
import { CommunityService } from '../../services/community.service';
import { AuthService } from '../../services/auth.service';
import { AirportAutocompleteService, AirportEntry } from '../../services/airport-autocomplete.service';
import { CommunityAuthorComponent, CommunityReactionsComponent, CommunityReportComponent } from './community-widgets';

@Component({
  selector: 'app-community', standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule, CommunityAuthorComponent, CommunityReactionsComponent, CommunityReportComponent],
  template: `<div class="community-shell">
    <header class="community-header"><h1 class="h4 mb-0">Travel Community</h1><div class="d-flex gap-2">
      <button class="btn btn-outline-secondary icon-button" title="Refresh" aria-label="Refresh community" [disabled]="loading" (click)="load(true)"><lucide-icon [img]="RefreshCw" [size]="18" /></button>
      <a routerLink="/community/new" class="btn btn-primary icon-button"><lucide-icon [img]="Plus" [size]="18" />Create Post</a>
    </div></header>
    <nav class="community-tabs" aria-label="Community views"><a routerLink="/community" [class.active]="!filters.mine" [attr.aria-current]="!filters.mine ? 'page' : null">Community</a><a routerLink="/community/my-posts" [class.active]="filters.mine" [attr.aria-current]="filters.mine ? 'page' : null">My Posts</a></nav>
    <form class="mb-4" (ngSubmit)="load(true)">
      <label class="form-label" for="communitySearch">Search community</label>
      <div class="d-flex gap-2"><input id="communitySearch" class="form-control" name="search" [(ngModel)]="filters.search" maxlength="200" type="search" /><button type="submit" class="btn btn-primary" [disabled]="loading">Search</button></div>
      <details class="mt-3"><summary>Filters</summary><div class="filter-grid mt-3">
        <div><label class="form-label" for="filterAirport">Airport</label><input id="filterAirport" class="form-control" name="airport" [(ngModel)]="filters.airport" list="communityAirports" maxlength="4" (input)="lookup($event)" /></div>
        <div><label class="form-label" for="filterCategory">Category</label><select id="filterCategory" class="form-select" name="category" [(ngModel)]="filters.category"><option value="">All categories</option><option *ngFor="let category of categories">{{ category }}</option></select></div>
        <div><label class="form-label" for="filterOrigin">Origin</label><input id="filterOrigin" class="form-control" name="origin" [(ngModel)]="filters.origin" list="communityAirports" maxlength="4" (input)="lookup($event)" /></div>
        <div><label class="form-label" for="filterDestination">Destination</label><input id="filterDestination" class="form-control" name="destination" [(ngModel)]="filters.destination" list="communityAirports" maxlength="4" (input)="lookup($event)" /></div>
        <div><label class="form-label" for="filterDate">Travel date</label><input id="filterDate" class="form-control" type="date" name="date" [(ngModel)]="filters.date" /></div>
        <div><label class="form-label" for="filterSort">Sort</label><select id="filterSort" class="form-select" name="sort" [(ngModel)]="filters.sort"><option value="latest">Latest</option><option value="discussed">Most Discussed</option></select></div>
      </div><div class="d-flex gap-2 mt-3"><button class="btn btn-outline-primary" type="submit" [disabled]="loading">Apply filters</button><button class="btn btn-outline-secondary" type="button" (click)="clearFilters()">Clear</button></div></details>
    </form>
    <datalist id="communityAirports"><option *ngFor="let airport of airports" [value]="airport.code">{{ airport.name }} - {{ airport.city }}</option></datalist>
    <p *ngIf="error" class="alert alert-danger" role="alert">{{ error }} <button class="btn btn-sm btn-outline-danger" (click)="load(true)">Retry</button></p>
    <p *ngIf="info" class="alert alert-success" role="status">{{ info }}</p>
    <input *ngIf="shareUrl" class="form-control share-link mb-3" aria-label="Post share link" readonly [value]="shareUrl" />
    <p *ngIf="loading" role="status">Loading community posts...</p>
    <p *ngIf="!loading && !error && !posts.length" class="py-4">{{ filters.mine ? 'You have not posted yet.' : 'No community posts yet. Start a conversation with other travelers.' }}</p>
    <div class="feed"><article class="post" *ngFor="let post of posts">
      <app-community-author [author]="post" [date]="post.created_at" /><div class="category mt-2">{{ post.category }}</div>
      <h2 class="post-title"><a [routerLink]="['/community',post.id]">{{ post.title }}</a></h2>
      <p class="body-text mb-2">{{ post.content | slice:0:600 }}{{ post.content.length > 600 ? '...' : '' }}</p>
      <div class="context"><span *ngIf="post.airport_code">Airport: {{ post.airport_code }}</span><span *ngIf="post.origin_airport">From: {{ post.origin_airport }}</span><span *ngIf="post.destination_airport">To: {{ post.destination_airport }}</span><span *ngIf="post.flight_number">Flight: {{ post.flight_number }}</span><span *ngIf="post.travel_date">Travel: {{ post.travel_date }}</span></div>
      <p *ngIf="post.airport_code || post.category === 'Airport Update'" class="notice">{{ notice }}</p>
      <app-community-reactions [value]="post" [busy]="busy.has(post.id)" (react)="react(post,$event)" />
      <div class="actions"><a class="btn btn-sm btn-outline-secondary icon-button" [routerLink]="['/community',post.id]"><lucide-icon [img]="MessageCircle" [size]="17" />{{ post.comment_count }} Comments</a>
        <button class="btn btn-sm btn-outline-secondary icon-button" aria-label="Share post" title="Share" (click)="share(post)"><lucide-icon [img]="Share2" [size]="17" /></button>
        <ng-container *ngIf="post.user_id === userId; else reportAction"><a class="btn btn-sm btn-outline-secondary icon-button" title="Edit post" aria-label="Edit post" [routerLink]="['/community',post.id,'edit']"><lucide-icon [img]="Pencil" [size]="17" /></a><button class="btn btn-sm btn-outline-danger icon-button" title="Delete post" aria-label="Delete post" [disabled]="busy.has(post.id)" (click)="remove(post)"><lucide-icon [img]="Trash2" [size]="17" /></button></ng-container>
        <ng-template #reportAction><button class="btn btn-sm btn-outline-secondary icon-button" aria-label="Report post" title="Report" (click)="reportId = post.id"><lucide-icon [img]="Flag" [size]="17" /></button></ng-template>
      </div><app-community-report *ngIf="reportId === post.id" [target]="{id:post.id,comment:false}" (closed)="reportId = ''; info = $event ? 'Report submitted for review.' : ''" />
    </article></div>
    <button *ngIf="hasMore" class="btn btn-outline-primary d-block mx-auto my-4" [disabled]="loading" (click)="load(false)">Load More</button>
  </div>`, styleUrl: './community.css'
})
export class CommunityComponent implements OnDestroy {
  readonly Plus=Plus; readonly RefreshCw=RefreshCw; readonly MessageCircle=MessageCircle; readonly Share2=Share2; readonly Flag=Flag; readonly Pencil=Pencil; readonly Trash2=Trash2;
  readonly categories=COMMUNITY_CATEGORIES; readonly notice=COMMUNITY_UPDATE_NOTICE;
  filters: CommunityFilters = { search:'',airport:'',category:'',origin:'',destination:'',date:'',sort:'latest',mine:false };
  private applied = { ...this.filters }; private offset=0; private generation=0; private controller?: AbortController;
  posts: CommunityPost[]=[]; airports: AirportEntry[]=[]; loading=false; hasMore=false; error=''; info=''; reportId=''; shareUrl='';
  busy=new Set<string>(); userId=''; private readonly subscriptions=new Subscription();
  constructor(private service: CommunityService, private auth: AuthService, private lookupService: AirportAutocompleteService, route: ActivatedRoute) {
    this.subscriptions.add(auth.session$.subscribe(session => { const id=session?.user.id || ''; if(id!==this.userId){this.userId=id;this.posts=[];this.controller?.abort();this.generation++;} }));
    this.subscriptions.add(combineLatest([route.data,route.queryParamMap]).subscribe(([data,params]) => { this.filters.mine=!!data['mine']; this.filters.airport=params.get('airport') || ''; void this.load(true); }));
    this.subscriptions.add(auth.appForeground$.subscribe(() => { if(!this.loading) void this.load(true); }));
  }
  clearFilters(){this.filters={search:'',airport:'',category:'',origin:'',destination:'',date:'',sort:'latest',mine:this.filters.mine};void this.load(true);}
  async load(reset:boolean){
    if(!this.userId)return; if(!reset&&this.loading)return;
    this.controller?.abort();const controller=new AbortController();this.controller=controller;const generation=++this.generation;
    if(reset){this.applied={...this.filters};this.offset=0;} this.loading=true;this.error='';
    try {const page=await this.service.feed(this.applied,this.offset,controller.signal);if(generation!==this.generation)return;
      const combined=reset?page.rows:[...this.posts,...page.rows];this.posts=[...new Map(combined.map(p=>[p.id,p])).values()];this.offset+=page.rows.length;this.hasMore=page.has_more;
    }catch(error){if(generation===this.generation)this.error=error instanceof Error?error.message:'Posts could not be loaded.';}
    finally{if(generation===this.generation)this.loading=false;}
  }
  async lookup(event:Event){try{this.airports=await this.lookupService.search((event.target as HTMLInputElement).value);}catch{this.airports=[];}}
  async react(post:CommunityPost,type:Reaction){if(this.busy.has(post.id))return;this.busy.add(post.id);this.error='';try{await this.service.react(post.id,false,type);const fresh=await this.service.post(post.id);this.posts=this.posts.map(p=>p.id===post.id?fresh:p);}catch{this.error='Reaction could not be updated. Refresh to check its status.';}finally{this.busy.delete(post.id);}}
  async remove(post:CommunityPost){if(!window.confirm('Delete this post and its comments?'))return;this.busy.add(post.id);try{await this.service.deletePost(post.id);this.info='Post deleted.';await this.load(true);}catch{this.error='Post could not be deleted.';}finally{this.busy.delete(post.id);}}
  async share(post:CommunityPost){const url=new URL('/community/'+post.id,window.location.origin).href;try{await navigator.clipboard.writeText(url);this.info='Post link copied.';}catch{this.shareUrl=url;this.info='Post link is ready to share.';}}
  ngOnDestroy(){this.generation++;this.controller?.abort();this.subscriptions.unsubscribe();}
}
