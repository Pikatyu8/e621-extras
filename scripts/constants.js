/* Shared by content scripts, popup and background — single source of truth for keys and message names. */
globalThis.E621_CONSTANTS = Object.freeze({
  SCHEMA_VERSION: 1,

  STORAGE_KEYS: Object.freeze({
    AI_HEURISTICS_ENABLED: 'e621_ai_heuristics_enabled',
    SCHEMA_VERSION: 'e621_schema_version',
    DOWNVOTES: 'e621_downvoted_posts',
    BLACKLIST_BACKUP: 'e621_clean_blacklist_backup',
    BLACKLIST_LOCKED: 'e621_load_blacklist_disabled',
    AUTO_UPDATE: 'e621_auto_update_enabled',
    SHOW_UPLOADER: 'e621_extra_show_uploader',
    ACTIVE_POPUP_TAB: 'e621_active_popup_tab',

    /* Hover Zoom keys */
    HZ_ENABLED: 'e621_hz_enabled',
    HZ_LOAD_SAMPLE: 'e621_hz_load_sample',
    HZ_TAGS: 'e621_hz_tags',
    HZ_TIME: 'e621_hz_time',
    HZ_AUDIO: 'e621_hz_audio',
    HZ_DELAY: 'e621_hz_delay',
    HZ_STICKY: 'e621_hz_sticky',

    /* Queued / Timeouted Tag Scripts keys */
    QUEUE_TAG_SCRIPTS_ENABLED: 'e621_queue_tag_scripts_enabled',
    TAG_SCRIPT_QUEUE: 'e621_tag_script_queue',
    QUEUE_TIMEOUT_UNTIL: 'e621_queue_timeout_until',
    QUEUE_SLOT_TIMESTAMPS: 'e621_queue_slot_timestamps',

    /* Preview & Tooltip suppression & Performance */
    CTRL_PREVIEW_ENABLED: 'e621_ctrl_preview_enabled',
    CTRL_PREVIEW_STICKY: 'e621_ctrl_preview_sticky',
    CTRL_STICKY_ACTIVE: 'e621_ctrl_sticky_active',
    HIDE_THUMB_TOOLTIPS: 'e621_hide_thumb_tooltips',
    TRACKING_FPS: 'e621_tracking_fps'
  }),

  ACTIONS: Object.freeze({
    CHECK_AI_HEURISTICS: 'checkAiHeuristics',
    BACKUP_BLACKLIST: 'backupBlacklist',
    LOAD_DOWNVOTES: 'loadDownvotes',
    UPLOAD_DOWNVOTES: 'uploadDownvotes',
    UNLOAD_DOWNVOTES: 'unloadDownvotes',
    SYNC_API: 'syncApi',
    TOGGLE_AUTO_UPDATE: 'toggleAutoUpdate',
    SHOW_POST_TREE: 'showPostTree',
    FETCH_IMAGE: 'fetchImageAsDataUrl',
    PROCESS_TAG_QUEUE: 'processTagQueue',
    CLEAR_TAG_QUEUE: 'clearTagQueue',
    ENQUEUE_TAG_SCRIPT: 'enqueueTagScript',
    DEQUEUE_TAG_SCRIPT: 'dequeueTagScript',
    SAVE_IMAGE: 'saveImage',
    GET_IMAGE: 'getImage',
    DELETE_IMAGE: 'deleteImage',
    CLEAR_IMAGES: 'clearImages',
    SET_CSRF_TOKEN: 'setCsrfToken',
    TAG_SCRIPT_POST_STATUS: 'tagScriptPostStatus'
  })
});