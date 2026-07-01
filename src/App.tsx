import { useEffect, useState } from 'react';

interface BookmarkFolder {
  id: string;
  title: string;
}

function App() {
  const [folders, setFolders] = useState<BookmarkFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [isWorkerRunning, setIsWorkerRunning] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Checking worker status...'
  );

  // 1. Function to poll background script status
  const checkWorkerStatus = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (response) => {
        if (response) {
          setIsWorkerRunning(response.isRunning);
          setStatusMessage(response.message);
        }
      });
    }
  };

  // 2. Load folders and start status tracking loop on mount
  useEffect(() => {
    // Fetch Bookmark Folders
    if (typeof chrome !== 'undefined' && chrome.bookmarks) {
      chrome.bookmarks.getTree((treeNodes) => {
        const folderList: BookmarkFolder[] = [];
        const findFolders = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
          for (const node of nodes) {
            if (node.children) {
              folderList.push({ id: node.id, title: node.title || 'Root' });
              findFolders(node.children);
            }
          }
        };
        findFolders(treeNodes);
        setFolders(folderList);
        if (folderList.length > 0) setSelectedFolderId(folderList[0].id);
      });
    }

    // Check status immediately
    checkWorkerStatus();

    // Set up a short polling interval to keep the popup UI smooth while open
    const interval = setInterval(checkWorkerStatus, 1000);
    return () => clearInterval(interval);
  }, []);

  // 3. Handle button execution triggering
  const handleValidate = () => {
    if (!selectedFolderId) return;

    setIsWorkerRunning(true);
    setStatusMessage('Starting background job...');

    chrome.runtime.sendMessage(
      { action: 'START_VALIDATION', folderId: selectedFolderId },
      (response) => {
        if (response && response.status === 'started') {
          setStatusMessage('Job accepted by background worker.');
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
          disabled={isWorkerRunning} // Locked while processing
          style={{
            width: '100%',
            padding: '6px',
            cursor: isWorkerRunning ? 'not-allowed' : 'default',
          }}
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
        disabled={isWorkerRunning || !selectedFolderId} // Disabled state locked out
        style={{
          width: '100%',
          padding: '8px',
          backgroundColor: isWorkerRunning ? '#999' : '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: isWorkerRunning ? 'not-allowed' : 'pointer',
        }}
      >
        {isWorkerRunning ? 'Worker Active...' : 'Begin Validation'}
      </button>

      {statusMessage && (
        <div
          style={{
            marginTop: '14px',
            padding: '8px',
            background: '#f4f4f5',
            borderRadius: '4px',
            border: '1px solid #e4e4e7',
          }}
        >
          <small
            style={{
              display: 'block',
              color: '#71717a',
              textTransform: 'uppercase',
              fontSize: '10px',
              fontWeight: 'bold',
            }}
          >
            System Status
          </small>
          <p
            style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#27272a' }}
          >
            {statusMessage}
          </p>
        </div>
      )}
    </div>
  );
}

export default App;
