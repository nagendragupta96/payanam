import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { LucideAngularModule, Share2, Flag, Pencil, Trash2, RefreshCw } from 'lucide-angular';
import { CommunityComment, CommunityPost, Reaction, COMMUNITY_PRIVACY_NOTICE, COMMUNITY_UPDATE_NOTICE } from '../../models/community.model';
import { CommunityService } from '../../services/community.service';
import { AuthService } from '../../services/auth.service';
import { CommunityAuthorComponent, CommunityReactionsComponent, CommunityReportComponent } from './community-widgets';

interface CommentList { rows:CommunityComment[]; offset:number; more:boolean; loading:boolean; error:string; }
const list = ():CommentList => ({rows:[],offset:0,more:false,loading:false,error:''});

@Component({
  selector:'app-community-detail',standalone:true,
  imports:[CommonModule,FormsModule,RouterLink,LucideAngularModule,CommunityAuthorComponent,CommunityReactionsComponent,CommunityReportComponent],
  template:`<div class="community-shell">
    <div class="community-header mb-3"><a routerLink="/community">Back to Community</a><button class="btn btn-outline-secondary icon-button" title="Refresh" aria-label="Refresh post" [disabled]="loading" (click)="load()"><lucide-icon [img]="RefreshCw" [size]="18" /></button></div>
    <p *ngIf="loading" role="status">Loading post...</p><p *ngIf="error" role="alert" class="alert alert-danger">{{error}} <button class="btn btn-outline-danger btn-sm" (click)="load()">Retry</button></p>
    <p *ngIf="info" role="status" class="alert alert-success">{{info}}</p>
    <input *ngIf="shareUrl" class="form-control mb-3" aria-label="Post share link" [value]="shareUrl" readonly />
    <article *ngIf="post" class="post">
      <app-community-author [author]="post" [date]="post.created_at" /><div class="category mt-2">{{post.category}}</div><h1 class="post-title">{{post.title}}</h1><p class="body-text">{{post.content}}</p>
      <div class="context"><span *ngIf="post.airport_code">Airport: {{post.airport_code}}</span><span *ngIf="post.origin_airport">From: {{post.origin_airport}}</span><span *ngIf="post.destination_airport">To: {{post.destination_airport}}</span><span *ngIf="post.flight_number">Flight: {{post.flight_number}}</span><span *ngIf="post.travel_date">Travel: {{post.travel_date}}</span></div>
      <p class="notice" *ngIf="post.airport_code || post.category === 'Airport Update'">{{notice}}</p>
      <app-community-reactions [value]="post" [busy]="busy.has(post.id)" (react)="react(post,$event,false)" />
      <div class="actions"><span>{{post.comment_count}} comments</span><button class="btn btn-sm btn-outline-secondary icon-button" title="Share" aria-label="Share post" (click)="share()"><lucide-icon [img]="Share2" [size]="17" /></button>
        <ng-container *ngIf="post.user_id === userId; else reportPost"><a class="btn btn-sm btn-outline-secondary icon-button" title="Edit post" aria-label="Edit post" [routerLink]="['/community',post.id,'edit']"><lucide-icon [img]="Pencil" [size]="17" /></a><button class="btn btn-sm btn-outline-danger icon-button" title="Delete post" aria-label="Delete post" [disabled]="busy.has(post.id)" (click)="removePost()"><lucide-icon [img]="Trash2" [size]="17" /></button></ng-container>
        <ng-template #reportPost><button class="btn btn-sm btn-outline-secondary icon-button" title="Report" aria-label="Report post" (click)="report={id:post.id,comment:false}"><lucide-icon [img]="Flag" [size]="17" /></button></ng-template>
      </div>
    </article>
    <app-community-report *ngIf="report && !report.comment" [target]="report" (closed)="report=null;info=$event ? 'Report submitted for review.' : ''" />
    <section *ngIf="post" class="mt-4" aria-labelledby="commentsHeading">
      <h2 id="commentsHeading" class="h5">Comments</h2><p class="small text-secondary">{{privacy}}</p>
      <form (ngSubmit)="addComment()"><label class="form-label" for="newComment">Add a comment</label><textarea id="newComment" class="form-control" [(ngModel)]="commentText" name="comment" rows="3" maxlength="3000" required></textarea><button class="btn btn-primary mt-2" type="submit" [disabled]="saving || !commentText.trim()">Post Comment</button></form>
      <p *ngIf="comments.loading" class="mt-3" role="status">Loading comments...</p><p *ngIf="comments.error" class="alert alert-danger mt-3" role="alert">{{comments.error}} <button class="btn btn-sm btn-outline-danger" (click)="loadComments(null,true)">Retry comments</button></p>
      <p *ngIf="!comments.loading && !comments.error && !comments.rows.length" class="mt-3">No comments yet.</p>
      <div *ngFor="let comment of comments.rows" class="comment">
        <ng-container *ngTemplateOutlet="commentBody;context:{$implicit:comment}" />
        <button *ngIf="comment.reply_count && !replies[comment.id]" class="btn btn-link p-0 mt-2" (click)="loadComments(comment.id,true)">View {{comment.reply_count}} replies</button>
        <div *ngIf="replies[comment.id] as thread" class="replies mt-3">
          <p *ngIf="thread.loading" role="status">Loading replies...</p><p *ngIf="thread.error" role="alert" class="text-danger">{{thread.error}} <button class="btn btn-link" (click)="loadComments(comment.id,true)">Retry replies</button></p>
          <div *ngFor="let reply of thread.rows" class="comment"><ng-container *ngTemplateOutlet="commentBody;context:{$implicit:reply}" /></div>
          <button *ngIf="thread.more" class="btn btn-outline-secondary mt-2" [disabled]="thread.loading" (click)="loadComments(comment.id,false)">Load More Replies</button>
        </div>
      </div>
      <button *ngIf="comments.more" class="btn btn-outline-secondary my-3" [disabled]="comments.loading" (click)="loadComments(null,false)">Load More Comments</button>
    </section>
    <ng-template #commentBody let-comment>
      <app-community-author [author]="comment" [date]="comment.created_at" />
      <ng-container *ngIf="editingId !== comment.id; else editForm"><p class="body-text mt-2 mb-2">{{comment.is_deleted ? 'Comment deleted.' : comment.content}}</p></ng-container>
      <ng-template #editForm><form (ngSubmit)="saveEdit(comment)"><label class="form-label" [for]="'edit-'+comment.id">Edit comment</label><textarea class="form-control" [id]="'edit-'+comment.id" [(ngModel)]="editText" name="edit" rows="3" maxlength="3000" required></textarea><button class="btn btn-primary mt-2 me-2" [disabled]="saving || !editText.trim()">Save Comment</button><button type="button" class="btn btn-outline-secondary mt-2" (click)="editingId=''">Cancel</button></form></ng-template>
      <ng-container *ngIf="!comment.is_deleted"><app-community-reactions [value]="comment" [busy]="busy.has(comment.id)" (react)="react(comment,$event,true)" />
        <div class="d-flex flex-wrap gap-2 mt-2">
          <button *ngIf="!comment.parent_comment_id" class="btn btn-sm btn-outline-secondary icon-button" (click)="replyTo=comment.id;replyText=''">Reply</button>
          <ng-container *ngIf="comment.user_id===userId; else reportComment"><button class="btn btn-sm btn-outline-secondary icon-button" title="Edit comment" aria-label="Edit comment" (click)="editingId=comment.id;editText=comment.content"><lucide-icon [img]="Pencil" [size]="17" /></button><button class="btn btn-sm btn-outline-danger icon-button" title="Delete comment" aria-label="Delete comment" [disabled]="busy.has(comment.id)" (click)="removeComment(comment)"><lucide-icon [img]="Trash2" [size]="17" /></button></ng-container>
          <ng-template #reportComment><button class="btn btn-sm btn-outline-secondary icon-button" title="Report comment" aria-label="Report comment" (click)="report={id:comment.id,comment:true}"><lucide-icon [img]="Flag" [size]="17" /></button></ng-template>
        </div>
      </ng-container>
      <app-community-report *ngIf="report?.comment && report?.id === comment.id" [target]="{id:comment.id,comment:true}" (closed)="report=null;info=$event ? 'Report submitted for review.' : ''" />
      <form *ngIf="replyTo===comment.id" class="mt-3" (ngSubmit)="addComment(comment.id)"><label class="form-label" [for]="'reply-'+comment.id">Your reply</label><textarea class="form-control" [id]="'reply-'+comment.id" name="reply" [(ngModel)]="replyText" maxlength="3000" rows="2" required></textarea><button class="btn btn-primary mt-2 me-2" [disabled]="saving || !replyText.trim()">Post Reply</button><button type="button" class="btn btn-outline-secondary mt-2" (click)="replyTo=''">Cancel</button></form>
    </ng-template>
  </div>`,styleUrl:'./community.css'
})
export class CommunityDetailComponent implements OnDestroy {
  readonly Share2=Share2;readonly Flag=Flag;readonly Pencil=Pencil;readonly Trash2=Trash2;readonly RefreshCw=RefreshCw;readonly notice=COMMUNITY_UPDATE_NOTICE;readonly privacy=COMMUNITY_PRIVACY_NOTICE;
  post:CommunityPost|null=null;comments=list();replies:Record<string,CommentList>={};id='';userId='';loading=false;saving=false;error='';info='';shareUrl='';
  report:{id:string;comment:boolean}|null=null;commentText='';replyTo='';replyText='';editingId='';editText='';busy=new Set<string>();
  private subscriptions=new Subscription();private generation=0;private controller=new AbortController();
  constructor(private service:CommunityService,auth:AuthService,route:ActivatedRoute,private router:Router){
    this.subscriptions.add(auth.session$.subscribe(session=>{const next=session?.user.id||'';if(next!==this.userId){this.userId=next;this.controller.abort();this.generation++;this.post=null;this.comments=list();this.replies={};this.replyTo='';this.editingId='';this.commentText='';}}));
    this.subscriptions.add(route.paramMap.subscribe(params=>{this.id=params.get('postId')||'';this.post=null;this.commentText='';this.replyTo='';this.editingId='';void this.load();}));
    this.subscriptions.add(auth.appForeground$.subscribe(()=>{if(!this.loading&&!this.saving)void this.load();}));
  }
  async load(){
    if(!this.id||!this.userId)return;this.controller.abort();this.controller=new AbortController();const generation=++this.generation;this.loading=true;this.error='';this.replies={};this.comments=list();
    try{const post=await this.service.post(this.id,this.controller.signal);if(generation!==this.generation)return;this.post=post;await this.loadComments(null,true);}
    catch(error){if(generation===this.generation){this.post=null;this.error=error instanceof Error?error.message:'Post could not be loaded.';}}
    finally{if(generation===this.generation)this.loading=false;}
  }
  async loadComments(parent:string|null,reset:boolean){
    const state=parent?(this.replies[parent]??=list()):this.comments;if(state.loading)return;
    const generation=this.generation;state.loading=true;state.error='';if(reset)state.offset=0;
    try{const page=await this.service.comments(this.id,parent,state.offset,this.controller.signal);if(generation!==this.generation)return;
      const rows=reset?page.rows:[...state.rows,...page.rows];state.rows=[...new Map(rows.map(c=>[c.id,c])).values()];state.offset+=page.rows.length;state.more=page.has_more;
    }catch{if(generation===this.generation)state.error='Comments could not be loaded.';}finally{state.loading=false;}
  }
  async addComment(parent:string|null=null){
    const content=(parent?this.replyText:this.commentText).trim();if(!content||this.saving)return;this.saving=true;this.error='';
    const generation=this.generation;const postId=this.id;
    try{await this.service.saveComment(postId,content,parent);if(generation!==this.generation)return;
      if(parent){this.replyTo='';this.replyText='';const root=this.comments.rows.find(c=>c.id===parent);if(root)root.reply_count++;}else this.commentText='';
      await this.loadComments(parent,true);const post=await this.service.post(postId,this.controller.signal);
      if(generation===this.generation){this.post=post;this.info=parent?'Reply posted.':'Comment posted.';}
    }catch{if(generation===this.generation)this.error='Comment could not be completed. Refresh to check whether it was saved before trying again.';}finally{this.saving=false;}
  }
  async saveEdit(comment:CommunityComment){if(this.saving||!this.editText.trim())return;this.saving=true;this.error='';try{await this.service.saveComment(this.id,this.editText.trim(),comment.parent_comment_id,comment.id);comment.content=this.editText.trim();this.editingId='';}catch{this.error='Comment could not be updated.';}finally{this.saving=false;}}
  async removeComment(comment:CommunityComment){if(!window.confirm('Delete this comment? Replies will remain.'))return;this.busy.add(comment.id);try{await this.service.deleteComment(comment.id);comment.is_deleted=true;comment.content='[Comment deleted]';if(this.post)this.post.comment_count=Math.max(0,this.post.comment_count-1);}catch{this.error='Comment could not be deleted.';}finally{this.busy.delete(comment.id);}}
  async react(target:CommunityPost|CommunityComment,type:Reaction,isComment:boolean){if(this.busy.has(target.id))return;this.busy.add(target.id);this.error='';try{await this.service.react(target.id,isComment,type);
      const old=target.my_reaction;if(old)target.reactions[old]=Math.max(0,(target.reactions[old]||0)-1);target.my_reaction=old===type?null:type;if(target.my_reaction)target.reactions[type]=(target.reactions[type]||0)+1;
    }catch{this.error='Reaction could not be updated. Refresh to check its status.';}finally{this.busy.delete(target.id);}}
  async removePost(){if(!this.post||!window.confirm('Delete this post and all its comments?'))return;this.busy.add(this.id);try{await this.service.deletePost(this.id);await this.router.navigate(['/community']);}catch{this.error='Post could not be deleted.';}finally{this.busy.delete(this.id);}}
  async share(){const url=new URL('/community/'+this.id,location.origin).href;try{await navigator.clipboard.writeText(url);this.info='Post link copied.';}catch{this.shareUrl=url;}}
  ngOnDestroy(){this.generation++;this.controller.abort();this.subscriptions.unsubscribe();}
}
