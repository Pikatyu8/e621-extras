/* Every selector that depends on site markup (or on other scripts) lives here.
 * After a site redesign, this is the only file to touch. */
E621X.define('selectors', [], () => ({
  // --- e621 markup ---
  csrfMeta: 'meta[name="csrf-token"]',
  postIdMeta: 'meta[name="post-id"]',
  blacklistMeta: 'meta[name="blacklisted-tags"]',
  siteUser: '#site-user',
  imageContainer: '#image-container',
  postInfoItems: '#post-information li',
  postInfoLists: '#post-information ul',
  thumbnail: 'article.thumbnail[data-id]',
  postContainerForId: '[data-id], [data-post-id], article.thumbnail, article.post',
  modeBox: '#mode-box',
  modeSelect: '#mode-box-mode',
  nativeTagScriptField: '#tag-script-field',
  parentChildren: '.parent-children',
  relationNotices: '.notice.notice-child, .notice.notice-parent',
  helpContentTargets: [
    '#c-help #content',
    '#content .dtext-container',
    '#content',
    '#c-help #a-show',
    '#help-page'
  ],
  voteButton: 'button[data-action="1"], button[data-action="-1"], .ptbr-vote-button',
  commentVoteClasses: ['comment-vote-down-link', 'comment-vote-up-link'],

  /* --- OPTIONAL integration with third-party scripts/extensions ---
   * These are not part of e621. Everything works without them (defaults are used),
   * but when present they give accurate vote state / thumbnail layout settings. */
  thirdParty: {
    voteContainer: '.ptbr-vote',
    imageContainInput: '#ssc-image-contain',
    cardSizeRadioName: 'ssc-card-size',
    cornerRibbonsInput: '#ssc-corner-ribbons',
    bodyAttrs: ['data-st-contain', 'data-st-size', 'data-st-cornerribbons'],
    localStorageKeys: {
      contain: 'e6.posts.contain',
      size: 'e6.posts.size',
      cornerRibbons: 'e6.posts.cribbons'
    }
  }
}));