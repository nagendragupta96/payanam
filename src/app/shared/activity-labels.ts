// Only these fixed button labels may enter telemetry; never collect arbitrary UI text.
export const ACTIVITY_CONTROLS: Record<string, string> = {
  publish: 'Publish itinerary', saveItinerary: 'Save Itinerary Changes',
  search: 'Search', addLeg: 'Add Leg', delete: 'Delete', cancel: 'Cancel',
  close: 'Close', refresh: 'Refresh', retry: 'Retry', logout: 'Logout',
  login: 'Login', signIn: 'Sign in', signUp: 'Sign up',
  companion: 'Companion Request', assistance: 'Assistance Request',
  requestContact: 'Request for Contact Details', saveContact: 'Save Contact Details',
  send: 'Send', sendRequest: 'Send Request', viewTrip: 'View Trip',
  accept: 'Accept', reject: 'Reject', editTrip: 'Edit Itinerary', deleteTrip: 'Delete Itinerary',
  previous: 'Previous page', next: 'Next page', more: 'More',
  languagesKnown: 'Languages Known', languages_known: 'Languages Known',
  postAnonymously: 'Post anonymously', is_anonymous: 'Post anonymously'
};

export const ACTIVITY_AREAS: Record<string, string> = {
  community: 'Travel Community', home: 'Home', auth: 'Sign in', profile: 'Profile', 'create-itinerary': 'Post Trip',
  'edit-itinerary': 'Edit Itinerary', 'my-trips': 'My Trips', search: 'Search',
  itinerary: 'Trip details', requests: 'Requests', messages: 'Messages', chat: 'Messages',
  notifications: 'Notifications', activity: 'My Activity', settings: 'Settings',
  subscription: 'Subscription', admin: 'Admin', 'admin-access': 'Admin access'
};

export interface PersonalActivity {
  id: number; created_at: string; source: string; action: string;
  entity_type: string | null; performed_by_you: boolean; affects_you: boolean;
  details: { area?: string; control?: string; status?: string; notification_type?: string; is_read?: boolean };
}

const entities: Record<string, string> = {
  itineraries: 'trip', itinerary_legs: 'trip leg', itinerary_contact_details: 'trip contact details',
  profiles: 'profile', users: 'account', requests: 'request', chat_threads: 'conversation',
  chat_messages: 'message', subscriptions: 'subscription', subscription_checkouts: 'checkout',
  notifications: 'notification', app_admins: 'admin access', community_posts: 'community post',
  community_comments: 'community comment', community_reactions: 'community reaction', community_reports: 'community report'
};

function controlName(control = ''): string {
  if (ACTIVITY_CONTROLS[control]) return ACTIVITY_CONTROLS[control];
  if (control.startsWith('nav-')) return ACTIVITY_AREAS[control.slice(4)] || 'navigation';
  if (/^(button|a|input|select|textarea|form):\d+$/.test(control)) {
    return ({ button: 'a button', a: 'a link', form: 'a form' } as Record<string, string>)[control.split(':')[0]] || 'a field';
  }
  return control.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase() || 'a control';
}

export function personalActivityText(event: PersonalActivity): string {
  const detail = event.details || {};
  const area = ACTIVITY_AREAS[detail.area ?? ''] || 'the app';
  const control = controlName(detail.control);
  const action = event.action;
  if (action === 'navigation') return `You opened ${area}.`;
  if (action === 'click') return `You selected ${control} in ${area}.`;
  if (action === 'change') return `You changed ${control} in ${area}.`;
  if (action === 'submit') return `You submitted a form in ${area}.`;
  const browserActions: Record<string, string> = {
    focus: 'You returned to the app window.', visible: 'You returned to the app tab.',
    hidden: 'You left the app tab.', online: 'Your connection came back online.', offline: 'Your connection went offline.'
  };
  if (browserActions[action]) return browserActions[action];
  if (action.startsWith('api.')) {
    const resource = detail.control?.split('/').pop() || '';
    const subject = entities[resource] || 'app data';
    return action === 'api.error' ? `A request for ${subject} failed.`
      : action === 'api.start' ? `A request for ${subject} started.` : `A request for ${subject} completed.`;
  }
  if (action === 'notification.available') {
    const type = event.entity_type === 'chat_messages' ? 'message' : 'trip request';
    return event.affects_you ? `A new ${type} notification became available for you.` : `Your ${type} triggered a notification.`;
  }
  if (action === 'notifications.insert') {
    const type = detail.notification_type === 'AUTO_MATCH' ? 'matching trip' : 'new';
    return event.affects_you ? `You received a ${type} notification.` : 'Your action created a notification.';
  }
  if (action === 'notifications.update') return detail.is_read === true
    ? 'A notification was marked as read.' : 'A notification was updated.';
  if (action === 'notifications.delete') return 'A notification was removed.';
  if (action === 'sessions.insert') return 'You signed in.';
  if (action === 'requests.insert' && event.affects_you && !event.performed_by_you) return 'You received a trip request.';
  if (action === 'sessions.delete') return 'Your sign-in session ended.';
  if (action === 'admin.delete_post') return 'You deleted a trip as an administrator.';
  if (action === 'admin.delete_user') return event.performed_by_you ? 'You deleted an account as an administrator.' : 'An administrator deleted your account.';
  if (action === 'admin.list' || action === 'admin.overview') return 'You viewed the Admin console.';
  const entity = entities[event.entity_type || ''] || 'record';
  const verb = ({ insert: 'created', update: 'updated', delete: 'deleted' } as Record<string, string>)[action.split('.').pop() || ''];
  if (verb) {
    const status = ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'ACTIVE', 'COMPLETED', 'EXPIRED'].includes(detail.status || '')
      ? ` Status: ${detail.status!.toLowerCase()}.` : '';
    return (event.performed_by_you ? `You ${verb} a ${entity}.` : `Your ${entity} was ${verb}.`) + status;
  }
  return 'Account activity was recorded.';
}
