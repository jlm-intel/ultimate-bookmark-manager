import { useEffect, useState } from 'react';

interface BookmarkFolder {
  id: string;
  title: string;
}

function App() {
  const [folders, setFolders] = useState<BookmarkFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  // 1. Fetch bookmark folders on component mount
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.bookmarks) {
      chrome.bookmarks.getTree((treeNodes) => {
        const folderList: BookmarkFolder[] = [];

        // Helper function to recursively find folders
        const findFolders = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
          for (const node of nodes) {
            // If it has children, it's a folder or a root category
            if (node.children) {
              folderList.push({
                id: node.id,
                title: node.title || 'Root / Unnamed Folder',
              });
              findFolders(node.children);
            }
          }
        };

        findFolders(treeNodes);
        setFolders(folderList);

        if (folderList.length > 0) {
          setSelectedFolderId(folderList[0].id);
        }
      });
    } else {
      // Fallback for local browser development testing
      setFolders([
        { id: '1', title: 'Favorites' },
        { id: '2', title: 'Tech Reading' },
      ]);
    }
  }, []);

  // 2. Handle validation logic
  const handleValidate = () => {
    if (!selectedFolderId) return;

    setIsValidating(true);
    setStatusMessage('Sending validation job to background thread...');

    // Send message to the background service worker
    chrome.runtime.sendMessage(
      { action: 'START_VALIDATION', folderId: selectedFolderId },
      (response) => {
        if (response && response.status === 'started') {
          setStatusMessage(
            'Validation running safely in background. You can close this popup!'
          );
          setIsValidating(false);
        }
      }
    );
  };

  return (
    <div style={{ padding: '16px', width: '300px', fontFamily: 'sans-serif' }}>
      <h3>Bookmark Validator</h3>

      <div style={{ marginBottom: '12px' }}>
        <label
          htmlFor="folder-select"
          style={{ display: 'block', marginBottom: '4px' }}
        >
          Select Folder:
        </label>
        <select
          id="folder-select"
          value={selectedFolderId}
          onChange={(e) => setSelectedFolderId(e.target.value)}
          disabled={isValidating}
          style={{ width: '100%', padding: '6px' }}
        >
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.title}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={handleValidate}
        disabled={isValidating || !selectedFolderId}
        style={{
          width: '100%',
          padding: '8px',
          backgroundColor: isValidating ? '#ccc' : '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: isValidating ? 'not-allowed' : 'pointer',
        }}
      >
        {isValidating ? 'Validating...' : 'Begin Validation'}
      </button>

      {statusMessage && (
        <p style={{ marginTop: '12px', fontSize: '14px', color: '#555' }}>
          {statusMessage}
        </p>
      )}
    </div>
  );
}

export default App;
