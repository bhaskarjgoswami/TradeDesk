// Capture only return-state flags, never the tokens themselves, before Auth
// consumes the URL fragment during client initialization.
export function captureAuthReturn(href) {
  const url=new URL(href);
  const hash=new URLSearchParams(url.hash.slice(1));
  return {
    error:hash.get('error_code')||url.searchParams.get('error_code')||((hash.has('error')||url.searchParams.has('error'))?'invalid':''),
    hasCredentials:!!((hash.get('access_token')&&hash.get('refresh_token'))||url.searchParams.get('code')),
  };
}
export const initialAuthReturn=typeof window==='undefined'?{error:'',hasCredentials:false}:captureAuthReturn(window.location.href);
export function confirmationRedirect(origin) {
  const url=new URL(origin);
  if(!['http:','https:'].includes(url.protocol))throw Error('Invalid authentication origin');
  return url.origin+'/auth/confirm';
}
export async function finishEmailConfirmation(auth,state) {
  if(state.error)return '/app?auth_error='+(state.error==='otp_expired'?'expired':'invalid');
  if(!state.hasCredentials)return '/app?auth_error=invalid';
  try {
    const {data,error}=await auth.getSession();
    if(error||!data.session)return '/app?auth_error=invalid';
    // The email is already verified. Return to sign-in as requested without
    // revoking sessions on the user's other devices.
    const signedOut=await auth.signOut({scope:'local'});
    if(signedOut.error)return '/app?auth_error=invalid';
    return '/app?confirmed=1';
  } catch {return '/app?auth_error=invalid';}
}
