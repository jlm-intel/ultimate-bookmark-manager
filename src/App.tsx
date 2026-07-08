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

  // New state variables for the timeout setting
  const [timeoutSeconds, setTimeoutSeconds] = useState<string>('5.0');

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

  useEffect(() => {
    // 1. Fetch Bookmark Folders with full breadcrumb paths
    if (typeof chrome !== 'undefined' && chrome.bookmarks) {
      chrome.bookmarks.getTree((treeNodes) => {
        const folderList: BookmarkFolder[] = [];

        // We add a 'currentPath' parameter to track the breadcrumbs recursively
        const findFolders = (
          nodes: chrome.bookmarks.BookmarkTreeNode[],
          currentPath: string = ''
        ) => {
          for (const node of nodes) {
            if (node.children) {
              // Skip tracking names for the invisible root node arrays if they lack titles
              const nodeTitle = node.title || (node.id === '0' ? '' : 'Root');

              // Build the folder's display name trail
              const newPath = currentPath
                ? `${currentPath} > ${nodeTitle}`
                : nodeTitle;

              // Only add folders that have an actual name/presence to display
              if (nodeTitle) {
                folderList.push({
                  id: node.id,
                  title: newPath, // This now stores the full path! e.g., "Bookmarks Bar > News"
                });
              }

              // Pass the updated path down to this folder's children
              findFolders(node.children, newPath);
            }
          }
        };

        findFolders(treeNodes);
        setFolders(folderList);
        if (folderList.length > 0) setSelectedFolderId(folderList[0].id);
      });
    }

    // Safe Storage API Check using optional chaining (?.)
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get({ timeoutSeconds: 5.0 }, (result) => {
        const storageData = result as { timeoutSeconds: number | string };
        setTimeoutSeconds(storageData.timeoutSeconds.toString());
      });
    } else {
      // Safe local web developer fallback path
      console.log(
        '[ENV CHECK] Running outside of extension popup context. Defaulting local UI view state.'
      );
      setTimeoutSeconds('5.0');
    }

    checkWorkerStatus();
    const interval = setInterval(checkWorkerStatus, 1000);
    return () => clearInterval(interval);
  }, []);

  // 3. Persist the timeout configuration whenever changed
  // src/App.tsx

  const handleTimeoutChange = (value: string) => {
    setTimeoutSeconds(value);

    const parsedFloat = parseFloat(value);
    if (!isNaN(parsedFloat) && parsedFloat > 0) {
      // Check if the storage API is present before writing to it
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ timeoutSeconds: parsedFloat });
      } else {
        console.log(
          '[ENV CHECK] Storage unavailable. Mocking change locally:',
          parsedFloat
        );
      }
    }
  };

  const handleValidate = () => {
    if (!selectedFolderId) return;
    setIsWorkerRunning(true);

    // Find the title/path of the folder matching our selected ID
    const selectedFolder = folders.find((f) => f.id === selectedFolderId);
    const folderPath = selectedFolder ? selectedFolder.title : selectedFolderId;

    chrome.runtime.sendMessage({
      action: 'START_VALIDATION',
      folderId: selectedFolderId,
      folderPath: folderPath, // <-- Send the path string to the background script
    });
  };

  return (
    <div style={{ padding: '16px', width: '300px', fontFamily: 'sans-serif' }}>
      <h3>Bookmark Validator</h3>

      {/* Folder Selection Dropdown */}
      <div style={{ marginBottom: '12px' }}>
        <label
          htmlFor="folder-select"
          style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}
        >
          Select Folder:
        </label>
        <select
          id="folder-select"
          value={selectedFolderId}
          onChange={(e) => setSelectedFolderId(e.target.value)}
          disabled={isWorkerRunning}
          style={{
            width: '100%',
            padding: '6px',
            textOverflow: 'ellipsis', // Truncates overly long paths with '...'
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.title}
            </option>
          ))}
        </select>
      </div>

      {/* Persistent Float Timeout Configuration Input Control */}
      <div style={{ marginBottom: '16px' }}>
        <label
          htmlFor="timeout-input"
          style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}
        >
          Network Timeout (seconds):
        </label>
        <input
          id="timeout-input"
          type="number"
          step="0.1"
          min="0.5"
          max="30"
          value={timeoutSeconds}
          onChange={(e) => handleTimeoutChange(e.target.value)}
          disabled={isWorkerRunning}
          style={{ width: '94%', padding: '6px' }}
        />
      </div>

      <button
        onClick={handleValidate}
        disabled={isWorkerRunning || !selectedFolderId}
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
