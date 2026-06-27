// src/background.ts

// _sender is not currently used; rename to 'sender' once implemented.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'START_VALIDATION') {
    const { folderId } = message;

    // Begin the validation in the background thread
    runValidation(folderId);

    // Respond back to the popup immediately that processing started
    sendResponse({ status: 'started' });
  }
  return true; // Keeps the message channel open for asynchronous responses if needed
});

async function runValidation(folderId: string) {
  console.log(
    `Background worker thread started validating folder: ${folderId}`
  );

  // Fetch the subtree from the background thread
  const subTree = await chrome.bookmarks.getSubTree(folderId);
  const bookmarkLinks = subTree[0].children?.filter((node) => node.url) || [];

  for (const link of bookmarkLinks) {
    if (!link.url) continue;

    console.log(`Checking link: ${link.url}`);

    try {
      // Perform the actual network fetch check
      const response = await fetch(link.url, {
        method: 'HEAD',
        mode: 'no-cors',
      });
      console.log(`Result for ${link.url}: ${response.status}`);
    } catch (error) {
      console.error(`Failed to reach ${link.url}:`, error);
    }
  }

  console.log('Background validation job completed.');
}
