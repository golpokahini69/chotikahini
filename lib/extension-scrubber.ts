/**
 * Pre-hydration scrubber for browser-extension DOM mutations.
 *
 * WHY THIS EXISTS
 * ---------------
 * Some browser extensions — "skin" / dark-mode themes in particular — walk
 * the document and stamp a marker attribute (`bis_skin_checked="1"`) onto
 * every element they touch. They do this *before* React hydrates, so the
 * DOM React compares against no longer matches the server-rendered HTML:
 *
 *   "A tree hydrated but some attributes of the server rendered HTML
 *    didn't match the client properties."
 *
 * The server markup is correct; the extension rewrote it in the browser.
 * React cannot patch the mismatch, so it logs the error and discards the
 * server HTML for that subtree.
 *
 * WHY A SCRUBBER RATHER THAN A CONSOLE FILTER
 * -------------------------------------------
 * Filtering `console.error` does not work here. Next.js's dev overlay
 * installs its own `console.error` wrapper (see
 * `next-devtools/userspace/app/errors/intercept-console-error.js`) and
 * records the error into its own error queue *before* any user-supplied
 * override is consulted. So the warning still reaches the overlay and the
 * browser console no matter how the override is written.
 *
 * Removing the attributes instead fixes the cause: the DOM matches the
 * server HTML again, React hydrates cleanly, and no warning is produced in
 * the first place.
 *
 * HOW IT WORKS
 * ------------
 * The script is emitted inline in `<head>`, which means it can run before
 * `document.documentElement` exists. It therefore:
 *
 *   1. scrubs whatever is already parsed,
 *   2. waits for `<html>` to appear before installing the observer, and
 *   3. keeps a `MutationObserver` running so attributes added *after*
 *      hydration (the extension may re-apply them on navigation) are
 *      stripped too.
 */

/** Attributes that extension scripts are known to inject. */
const INJECTED_ATTRIBUTES = ["bis_skin_checked"];

/**
 * Build the inline script that removes extension-injected attributes.
 *
 * Kept as a string because it has to run synchronously, before React
 * hydrates — a client component would be far too late.
 */
export function buildExtensionScrubberScript(): string {
  return `(function(){try{var BAD=${JSON.stringify(INJECTED_ATTRIBUTES)};function scrubNode(el){if(!el||el.nodeType!==1)return;for(var i=0;i<BAD.length;i++){if(el.hasAttribute(BAD[i]))el.removeAttribute(BAD[i]);}var kids=el.children;for(var j=0;j<kids.length;j++)scrubNode(kids[j]);}function scrubTree(){scrubNode(document.documentElement);}function start(){scrubTree();if(!window.MutationObserver)return;try{var mo=new MutationObserver(function(muts){for(var i=0;i<muts.length;i++){var m=muts[i];if(m.type==="attributes"){if(BAD.indexOf(m.attributeName)!==-1&&m.target.removeAttribute)m.target.removeAttribute(m.attributeName);}else{for(var j=0;j<m.addedNodes.length;j++)scrubNode(m.addedNodes[j]);}}});mo.observe(document.documentElement||document,{childList:true,subtree:true,attributes:true,attributeFilter:BAD});}catch(e){}}if(document.documentElement){start();}else{document.addEventListener("readystatechange",function(){if(document.documentElement)start();});if(window.MutationObserver){try{var boot=new MutationObserver(function(){if(document.documentElement){boot.disconnect();start();}});boot.observe(document,{childList:true,subtree:true});}catch(e){}}document.addEventListener("DOMContentLoaded",function(){scrubTree();});}}catch(e){}})();`;
}
