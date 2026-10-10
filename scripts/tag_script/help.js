/* Injects documentation into the native e621 help and wiki pages. */
E621X.define('tagScriptHelp', ['selectors', 'dtext'], (SEL, DText) => {
  'use strict';

  const HELP_ELEMENT_ID = 'extended-tag-scripts-help';

  const HELP_DTEXT = [
    'h2#extended. Extended Tag Scripts (e621 extras)',
    '',
    'The "e621 extras" extension adds an [b]Extended Mode[/b] toggle to the Tag Script panel. This mode enables search syntax predicates and recursively nested commands.',
    '',
    '[quote]',
    'h4. Presets',
    'Save and switch between full tag script configurations (slots 1-9) for specific tagging projects (such as subject count cleanup, species tagging, or rating projects).',
    '[/quote]',
    '',
    '[quote]',
    'h4. Full Search Syntax in Conditions',
    'Everything you can find "here":[/help/cheatsheet] can be used in a tag script, which is not that helpful since you can just use search.',
    '',
    'A few examples where it actually saves time when batch-tagging:',
    '* `[if *dragon*, mythical_creature]` — wildcard matching across tags.',
    '* `[if ~dog ~wolf ~fox ~coyote, canine]` — OR condition using `~` prefix (adds a common tag if any match).',
    '* `[if -sound, no_sound]` — checking absent tags.',
    '',
    'In Extended Mode the full post is loaded before every check, so metatags such as score, rating, width or pool are exact. A metatag that is not supported stops the script with an error instead of being treated as a tag.',
    '[/quote]',
    '',
    '[quote]',
    'h4. Nested Commands',
    'Yes, now `[if cat, [reset]]` will work.',
    '[/quote]',
    '',
    '[quote]',
    'h4. Metatag Modifiers in Actions',
    'Tag scripts can execute native server metatags directly:',
    '* `parent:12345` / `parent:none` — assigns or unlinks a parent post.',
    '* `pool:123` / `-pool:123` — adds to or removes from a pool.',
    '[/quote]'
  ].join('\n');

  const isHelpPage = () =>
    location.pathname.startsWith('/help/tag_scripts') ||
    location.pathname.startsWith('/wiki_pages/tag_scripts') ||
    location.search.includes('title=help:tag_scripts') ||
    location.search.includes('title=tag_scripts');

  async function setupHelpPageDocs() {
    if (!isHelpPage() || document.getElementById(HELP_ELEMENT_ID)) return;

    const container = document.createElement('div');
    container.id = HELP_ELEMENT_ID;
    container.className = 'styled-dtext section e621x-help-box';

    const parent = SEL.helpContentTargets.map(s => document.querySelector(s)).find(Boolean) || document.body;
    parent.appendChild(container);

    container.innerHTML = await DText.renderDText(HELP_DTEXT);

    if (location.hash === '#extended') {
      setTimeout(() => container.scrollIntoView({ behavior: 'smooth' }), 150);
    }
  }

  return { isHelpPage, setupHelpPageDocs };
});