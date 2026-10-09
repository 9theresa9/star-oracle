import './observatory.css';
/** Original vector artwork: a daylight observatory, with no remote imagery or trackers. */
export function Observatory({className=''}:{className?:string}){
 return <div className={'observatory '+className} aria-hidden="true"><svg viewBox="0 0 640 680" preserveAspectRatio="xMidYMid slice" role="presentation">
  <defs><linearGradient id="oracle-sky" x2="0" y2="1"><stop stopColor="#d4e9f4"/><stop offset=".62" stopColor="#f6fbfd"/><stop offset="1" stopColor="#abcbdc"/></linearGradient><radialGradient id="oracle-moon"><stop stopColor="#fff"/><stop offset=".75" stopColor="#fdfefe"/><stop offset="1" stopColor="#e2edf1"/></radialGradient><linearGradient id="oracle-sea" x2="0" y2="1"><stop stopColor="#88b6cd" stopOpacity=".65"/><stop offset="1" stopColor="#d2e6ef" stopOpacity=".1"/></linearGradient></defs>
  <rect width="640" height="680" fill="url(#oracle-sky)"/><circle cx="372" cy="266" r="136" fill="url(#oracle-moon)"/>
  <g fill="none" stroke="#6b98ad" strokeWidth=".8" opacity=".6"><ellipse cx="326" cy="287" rx="237" ry="139" transform="rotate(-34 326 287)"/><ellipse cx="326" cy="287" rx="197" ry="225" transform="rotate(22 326 287)"/><circle cx="326" cy="287" r="207" strokeDasharray="2 9"/><path d="M84 287h480M326 58v456" opacity=".3"/></g>
  <g fill="#5587a2"><circle cx="132" cy="389" r="5"/><circle cx="494" cy="126" r="3"/><circle cx="167" cy="148" r="2"/><path d="m286 106 3 12 12 3-12 3-3 12-3-12-12-3 12-3Zm208 222 3 10 10 3-10 3-3 10-3-10-10-3 10-3Z"/></g>
  <path d="M0 467Q160 452 320 467T640 467V680H0Z" fill="url(#oracle-sea)"/><g fill="none" stroke="#f5fbff" strokeWidth="1.5" opacity=".8"><path d="M0 480Q160 464 320 480T640 480M0 504Q160 488 320 504T640 504M0 548Q160 532 320 548T640 548M0 608Q160 592 320 608T640 608"/></g>
  <path d="M324 414h4v169h-4z" fill="#fff" opacity=".25"/><path d="M294 455h64l40 190H254z" fill="#fff" opacity=".19"/>
 </svg><span className="observatory-caption">观星，亦是观心。</span></div>;
}
