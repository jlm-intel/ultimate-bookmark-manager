import { useEffect, useState } from 'react';

interface BookmarkFolder {
  id: string;
  title: string;
}

function App() {
  const [folders, setFolders] = useState<BookmarkFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [targetFolderId, setTargetFolderId] = useState<string>(''); // NEW: Target folder state tracking
  const [isWorkerRunning, setIsWorkerRunning] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Checking worker status...'
  );

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
    if (typeof chrome !== 'undefined' && chrome.bookmarks) {
      chrome.bookmarks.getTree((treeNodes) => {
        const folderList: BookmarkFolder[] = [];

        const findFolders = (
          nodes: chrome.bookmarks.BookmarkTreeNode[],
          currentPath: string = ''
        ) => {
          for (const node of nodes) {
            if (node.children) {
              const nodeTitle = node.title || (node.id === '0' ? '' : 'Root');
              const newPath = currentPath
                ? `${currentPath} > ${nodeTitle}`
                : nodeTitle;

              if (nodeTitle) {
                folderList.push({
                  id: node.id,
                  title: newPath,
                });
              }
              findFolders(node.children, newPath);
            }
          }
        };

        findFolders(treeNodes);
        setFolders(folderList);
        if (folderList.length > 0) {
          setSelectedFolderId(folderList[0].id);
          setTargetFolderId(folderList[0].id); // Initialize target to first available folder index
        }
      });
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get({ timeoutSeconds: 5.0 }, (result) => {
        const storageData = result as { timeoutSeconds: number | string };
        setTimeoutSeconds(storageData.timeoutSeconds.toString());
      });
    } else {
      console.log(
        '[ENV CHECK] Running outside of extension popup context. Defaulting local UI view state.'
      );
      setTimeoutSeconds('5.0');
    }

    checkWorkerStatus();
    const interval = setInterval(checkWorkerStatus, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleTimeoutChange = (value: string) => {
    setTimeoutSeconds(value);
    const parsedFloat = parseFloat(value);
    if (!isNaN(parsedFloat) && parsedFloat > 0) {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ timeoutSeconds: parsedFloat });
      }
    }
  };

  const handleValidate = () => {
    if (!selectedFolderId) return;
    setIsWorkerRunning(true);

    const selectedFolder = folders.find((f) => f.id === selectedFolderId);
    const folderPath = selectedFolder ? selectedFolder.title : selectedFolderId;

    chrome.runtime.sendMessage({
      action: 'START_VALIDATION',
      folderId: selectedFolderId,
      folderPath: folderPath,
    });
  };

  const handlePurgeBroken = () => {
    const confirmed = window.confirm(
      'Are you sure you want to permanently delete ALL bookmarks inside the "Broken Bookmarks Review" folder?'
    );
    if (!confirmed) return;

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      setStatusMessage('Purging broken bookmarks folder...');
      chrome.runtime.sendMessage(
        { action: 'PURGE_BROKEN_BOOKMARKS' },
        (response) => {
          if (response && response.success) {
            setStatusMessage(`Success: ${response.message}`);
          } else {
            setStatusMessage(
              `Notice: ${response?.message || 'No action taken.'}`
            );
          }
        }
      );
    }
  };

  // NEW: Consolidation Handler Execution Script
  const handleConsolidate = () => {
    if (!selectedFolderId || !targetFolderId) return;

    if (selectedFolderId === targetFolderId) {
      alert(
        'Source folder and Target folder cannot be the same directory location.'
      );
      return;
    }

    const sourceFolder = folders.find((f) => f.id === selectedFolderId);
    const targetFolder = folders.find((f) => f.id === targetFolderId);

    const confirmed = window.confirm(
      `Are you sure you want to consolidate these bookmarks?\n\n` +
        `Source (From): "${sourceFolder?.title}"\n` +
        `Target (Into): "${targetFolder?.title}"\n\n` +
        `This action will move all bookmarks from the source folder into the target folder.`
    );

    if (!confirmed) return;

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      setStatusMessage('Consolidating folders...');
      chrome.runtime.sendMessage(
        {
          action: 'CONSOLIDATE_FOLDERS',
          sourceId: selectedFolderId,
          targetId: targetFolderId,
        },
        (response) => {
          if (response && response.success) {
            setStatusMessage(`Success: ${response.message}`);
          } else {
            setStatusMessage(
              `Error: ${response?.message || 'Consolidation failed.'}`
            );
          }
        }
      );
    }
  };

  const handleCleanEmptyFolders = () => {
    const confirmed = window.confirm(
      'Are you sure you want to recursively search for and permanently delete all empty bookmark folders?'
    );
    if (!confirmed) return;

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      setStatusMessage('Sweeping tree for empty folders...');
      chrome.runtime.sendMessage(
        { action: 'CLEAN_EMPTY_FOLDERS' },
        (response) => {
          if (response && response.success) {
            setStatusMessage(`Success: ${response.message}`);
          } else {
            setStatusMessage(`Error: ${response?.message || 'Sweep failed.'}`);
          }
        }
      );
    }
  };

  return (
    <div style={{ padding: '16px', width: '300px', fontFamily: 'sans-serif' }}>
      <h3>Bookmark Tools</h3>

      {/* Source Selection Dropdown Control */}
      <div style={{ marginBottom: '12px' }}>
        <label
          htmlFor="folder-select"
          style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}
        >
          Select Folder (Source):
        </label>
        <select
          id="folder-select"
          value={selectedFolderId}
          onChange={(e) => setSelectedFolderId(e.target.value)}
          disabled={isWorkerRunning}
          style={{
            width: '100%',
            padding: '6px',
            textOverflow: 'ellipsis',
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

      {/* NEW: Target Selection Dropdown Control */}
      <div style={{ marginBottom: '12px' }}>
        <label
          htmlFor="target-folder-select"
          style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}
        >
          Consolidation Target Folder:
        </label>
        <select
          id="target-folder-select"
          value={targetFolderId}
          onChange={(e) => setTargetFolderId(e.target.value)}
          disabled={isWorkerRunning}
          style={{
            width: '100%',
            padding: '6px',
            textOverflow: 'ellipsis',
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

      {/* Persistent Float Timeout Input Configuration */}
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

      {/* Main Validation Button */}
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

      {/* NEW: Consolidate Folders Action Button */}
      <button
        onClick={handleConsolidate}
        disabled={isWorkerRunning || !selectedFolderId || !targetFolderId}
        style={{
          width: '100%',
          padding: '8px',
          marginTop: '8px',
          backgroundColor:
            isWorkerRunning || selectedFolderId === targetFolderId
              ? '#ccc'
              : '#28a745',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor:
            isWorkerRunning || selectedFolderId === targetFolderId
              ? 'not-allowed'
              : 'pointer',
        }}
      >
        Consolidate Folders
      </button>

      {/* Purge Review Folder Action Button */}
      <button
        onClick={handlePurgeBroken}
        disabled={isWorkerRunning}
        style={{
          width: '100%',
          padding: '8px',
          marginTop: '8px',
          backgroundColor: isWorkerRunning ? '#ccc' : '#dc3545',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: isWorkerRunning ? 'not-allowed' : 'pointer',
        }}
      >
        Empty Review Folder
      </button>

      {/* NEW: Recursive Empty Folder Purge Action Button */}
      <button
        onClick={handleCleanEmptyFolders}
        disabled={isWorkerRunning}
        style={{
          width: '100%',
          padding: '8px',
          marginTop: '8px',
          backgroundColor: isWorkerRunning ? '#ccc' : '#6c757d', // Slate grey styling
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: isWorkerRunning ? 'not-allowed' : 'pointer',
        }}
      >
        Clean Empty Folders
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
