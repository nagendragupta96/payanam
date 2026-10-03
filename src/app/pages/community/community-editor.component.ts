import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { COMMUNITY_CATEGORIES, COMMUNITY_PRIVACY_NOTICE, PostInput } from '../../models/community.model';
import { CommunityService } from '../../services/community.service';
import { AuthService } from '../../services/auth.service';
import { AirportAutocompleteService, AirportEntry } from '../../services/airport-autocomplete.service';
import { ItineraryService } from '../../services/itinerary.service';

@Component({
  selector: 'app-community-editor', standalone:true, imports:[CommonModule,ReactiveFormsModule,RouterLink],
  template:`<section class="community-shell">
    <a routerLink="/community" class="link-secondary">Back to Community</a><h1 class="h4 mt-3">{{id ? 'Edit Post' : 'Create Post'}}</h1>
    <p class="notice">{{privacy}}</p><p *ngIf="loading" role="status">Loading post...</p><p *ngIf="error" role="alert" class="alert alert-danger">{{error}}</p>
    <button *ngIf="loadFailed" type="button" class="btn btn-outline-primary" (click)="load()">Retry</button>
    <form [formGroup]="form" (ngSubmit)="save()" *ngIf="!loading && !loadFailed">
      <div class="mb-3"><label for="postCategory" class="form-label">Category *</label><select id="postCategory" class="form-select" formControlName="category"><option value="">Select category</option><option *ngFor="let category of categories">{{category}}</option></select></div>
      <div class="mb-3"><label for="postTitle" class="form-label">Title *</label><input id="postTitle" class="form-control" formControlName="title" maxlength="160" /></div>
      <div class="mb-3"><label for="postContent" class="form-label">Description *</label><textarea id="postContent" class="form-control" formControlName="content" rows="7" maxlength="10000"></textarea></div>
      <div class="filter-grid">
        <div><label for="postAirport" class="form-label">Airport (optional)</label><input id="postAirport" class="form-control text-uppercase" formControlName="airport_code" maxlength="4" list="postAirports" (input)="lookup($event)" /></div>
        <div><label for="postFlight" class="form-label">Flight Number (optional)</label><input id="postFlight" class="form-control text-uppercase" formControlName="flight_number" maxlength="20" /></div>
        <div><label for="postOrigin" class="form-label">Origin Airport (optional)</label><input id="postOrigin" class="form-control text-uppercase" formControlName="origin_airport" maxlength="4" list="postAirports" (input)="lookup($event)" /></div>
        <div><label for="postDestination" class="form-label">Destination Airport (optional)</label><input id="postDestination" class="form-control text-uppercase" formControlName="destination_airport" maxlength="4" list="postAirports" (input)="lookup($event)" /></div>
        <div><label for="postTravelDate" class="form-label">Travel Date (optional)</label><input id="postTravelDate" type="date" class="form-control" formControlName="travel_date" /></div>
      </div>
      <p *ngIf="form.touched && form.invalid" class="field-error mt-2">Category, title and description are required. Airport codes must contain 3 or 4 letters.</p>
      <div class="d-flex gap-2 mt-4"><button class="btn btn-primary" type="submit" [disabled]="saving">{{saving ? 'Saving...' : id ? 'Save Changes' : 'Publish Post'}}</button><a class="btn btn-outline-secondary" [routerLink]="id ? ['/community',id] : ['/community']">Cancel</a></div>
    </form><datalist id="postAirports"><option *ngFor="let airport of airports" [value]="airport.code">{{airport.name}} - {{airport.city}}</option></datalist>
  </section>`, styleUrl:'./community.css'
})
export class CommunityEditorComponent implements OnDestroy {
  readonly categories=COMMUNITY_CATEGORIES;readonly privacy=COMMUNITY_PRIVACY_NOTICE;
  id='';loading=false;saving=false;loadFailed=false;error='';airports:AirportEntry[]=[];
  private generation=0;private subscription:Subscription;private controller?:AbortController;
  form=this.fb.nonNullable.group({category:['',Validators.required],title:['',[Validators.required,Validators.maxLength(160),Validators.pattern(/\S/)]],
    content:['',[Validators.required,Validators.maxLength(10000),Validators.pattern(/\S/)]],airport_code:['',Validators.pattern(/^[a-zA-Z]{3,4}$/)],
    origin_airport:['',Validators.pattern(/^[a-zA-Z]{3,4}$/)],destination_airport:['',Validators.pattern(/^[a-zA-Z]{3,4}$/)],flight_number:['',Validators.maxLength(20)],travel_date:['']});
  constructor(private fb:FormBuilder,private service:CommunityService,private auth:AuthService,private airportsService:AirportAutocompleteService,private trips:ItineraryService,private route:ActivatedRoute,private router:Router){
    this.subscription=route.paramMap.subscribe(params=>{this.id=params.get('postId')||'';void this.load();});
  }
  async load(){
    const generation=++this.generation;this.controller?.abort();this.controller=new AbortController();this.loading=true;this.error='';this.loadFailed=false;
    this.form.reset();
    try{
      if(this.id){const post=await this.service.post(this.id,this.controller.signal);if(generation!==this.generation)return;if(post.user_id!==this.auth.currentSession?.user.id)throw new Error('You can only edit your own posts.');
        this.form.patchValue({category:post.category,title:post.title,content:post.content,airport_code:post.airport_code||'',origin_airport:post.origin_airport||'',destination_airport:post.destination_airport||'',flight_number:post.flight_number||'',travel_date:post.travel_date||''});
      }else{const tripId=this.route.snapshot.queryParamMap.get('trip');if(tripId){const result=await this.trips.findById(tripId);if(generation!==this.generation)return;
        if(result.error||!result.data||result.data.owner_id!==this.auth.currentSession?.user.id)throw new Error('Only your own trips can prefill a community post.');
        const trip=result.data;this.form.patchValue({origin_airport:trip.origin_airport_code,destination_airport:trip.destination_airport_code,travel_date:trip.start_date,flight_number:trip.legs?.[0]?.flight_number||''});
      }}
    }catch(error){if(generation===this.generation){this.error=error instanceof Error?error.message:'Post could not be loaded.';this.loadFailed=true;}}
    finally{if(generation===this.generation)this.loading=false;}
  }
  async lookup(event:Event){try{this.airports=await this.airportsService.search((event.target as HTMLInputElement).value);}catch{this.airports=[];}}
  async save(){if(this.saving||this.loading||this.loadFailed)return;this.form.markAllAsTouched();if(this.form.invalid)return;
    this.saving=true;this.error='';const generation=this.generation;const userId=this.auth.currentSession?.user.id;const value=this.form.getRawValue();const code=(input:string)=>input.trim().toUpperCase()||null;
    const input:PostInput={category:value.category,title:value.title.trim(),content:value.content.trim(),airport_code:code(value.airport_code),origin_airport:code(value.origin_airport),destination_airport:code(value.destination_airport),flight_number:code(value.flight_number),travel_date:value.travel_date||null};
    try{const id=await this.service.save(input,this.id||undefined);if(generation===this.generation&&userId===this.auth.currentSession?.user.id)await this.router.navigate(['/community',id]);}catch(error){if(generation===this.generation)this.error=error instanceof Error?error.message:'Post could not be saved.';}finally{this.saving=false;}
  }
  ngOnDestroy(){this.generation++;this.controller?.abort();this.subscription.unsubscribe();}
}
