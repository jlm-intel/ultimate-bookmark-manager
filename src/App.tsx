/**
 * Ultimate Bookmark Manager - Chrome Extension
 * Copyright (C) 2026  Josh Mayfield (UltimateOutsider) <ultimateoutsider@ultimateoutsider.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// src/App.tsx
import { useEffect, useState } from 'react';
const IDLE_STRING = 'Idle';

interface BookmarkFolder {
  id: string;
  title: string;
}

function App() {
  // React useState hooks for managing component state
  const [folders, setFolders] = useState<BookmarkFolder[]>([]);
  const [sourceFolderId, setSourceFolderId] = useState<string>('');
  const [targetFolderId, setTargetFolderId] = useState<string>('');
  const [isWorkerRunning, setIsWorkerRunning] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Checking worker status...'
  );
  const [completionMessage, setCompletionMessage] = useState<string>('');
  const [timeoutSeconds, setTimeoutSeconds] = useState<string>('5.0');
  const [isDebugLoggingEnabled, setIsDebugLoggingEnabled] =
    useState<boolean>(false);

  // Function to check the status of the background worker
  const checkWorkerStatus = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (response) => {
        if (response) {
          setIsWorkerRunning(response.isRunning);
          setStatusMessage(response.message);
          if (response.completion) {
            setCompletionMessage(response.completion);
          }
        }
      });
    }
  };

  useEffect(() => {
    // React useEffect hook to fetch bookmark folders and initialize state on component mount
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

        // Find all bookmark folders and populate the folder list controls
        findFolders(treeNodes);
        setFolders(folderList);
        if (folderList.length > 0) {
          setSourceFolderId(folderList[0].id);
          setTargetFolderId(folderList[0].id);
        }
      });
    }

    // Load persistent settings from chrome.storage.local if available
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(
        { timeoutSeconds: 5.0, isDebugLoggingEnabled: false },
        (result) => {
          const storageData = result as {
            timeoutSeconds: number | string;
            isDebugLoggingEnabled: boolean;
          };
          setTimeoutSeconds(storageData.timeoutSeconds.toString());
          setIsDebugLoggingEnabled(storageData.isDebugLoggingEnabled ?? false);
        }
      );
    } else {
      console.log(
        '[ENV CHECK] Running outside of extension popup context. Defaulting local UI view state.'
      );
      setTimeoutSeconds('5.0');
      setIsDebugLoggingEnabled(false);
    }

    // Do an initial check of the worker status and set up a periodic interval to poll it
    checkWorkerStatus();
    const interval = setInterval(checkWorkerStatus, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleTimeoutChange = (value: string) => {
    // Update the timeoutSeconds state and persist the value to chrome.storage.local if valid
    setTimeoutSeconds(value);
    const parsedFloat = parseFloat(value);
    if (!isNaN(parsedFloat) && parsedFloat > 0) {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ timeoutSeconds: parsedFloat });
      }
    }
  };

  const handleDebugLoggingChange = (enabled: boolean) => {
    // Update the isDebugLoggingEnabled state and persist the value to chrome.storage.local
    setIsDebugLoggingEnabled(enabled);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ isDebugLoggingEnabled: enabled });
    }
  };

  const handleValidate = () => {
    // Trigger the validation process by sending a message to the background script
    if (!sourceFolderId) return;
    setIsWorkerRunning(true);

    const sourceFolder = folders.find((f) => f.id === sourceFolderId);
    const folderPath = sourceFolder ? sourceFolder.title : sourceFolderId;

    chrome.runtime.sendMessage({
      action: 'START_VALIDATION',
      folderId: sourceFolderId,
      folderPath: folderPath,
    });
  };

  const handlePurgeBroken = () => {
    const confirmed = window.confirm(
      'Are you sure you want to permanently delete ALL bookmarks inside the "Broken Bookmarks Quarantine" folder?'
    );
    if (!confirmed) return;

    // kick off purge action by sending a message to the background script
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      setStatusMessage('Purging broken bookmarks quarantine folder...');
      chrome.runtime.sendMessage(
        { action: 'PURGE_BROKEN_BOOKMARKS' },
        (response) => {
          if (response && response.success) {
            setCompletionMessage(`Success: ${response.completion}`);
          } else {
            setCompletionMessage(
              `Error: ${response?.completion || 'No action taken.'}`
            );
          }
        }
      );
      setStatusMessage(IDLE_STRING);
    }
  };

  // NEW: Consolidation Handler Execution Script
  const handleConsolidate = () => {
    // don't proceed if either source or target folder is not selected
    if (!sourceFolderId || !targetFolderId) return;

    // don't allow consolidation if source and target folders are the same
    if (sourceFolderId === targetFolderId) {
      alert(
        'Source folder and Target folder cannot be the same directory location.'
      );
      return;
    }

    // get handles for the source and target folders to display their titles in the confirmation dialog
    const sourceFolder = folders.find((f) => f.id === sourceFolderId);
    const targetFolder = folders.find((f) => f.id === targetFolderId);

    // show a confirmation dialog to the user before proceeding with the consolidation
    const confirmed = window.confirm(
      `Are you sure you want to consolidate these bookmarks?\n\n` +
        `Source (From): "${sourceFolder?.title}"\n` +
        `Target (Into): "${targetFolder?.title}"\n\n` +
        `This action will move all bookmarks from the source folder into the target folder.`
    );

    if (!confirmed) return;

    // if user confirms, send a message to the background script to perform the consolidation
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      setStatusMessage('Consolidating folders...');
      chrome.runtime.sendMessage(
        {
          action: 'CONSOLIDATE_FOLDERS',
          sourceId: sourceFolderId,
          targetId: targetFolderId,
        },
        (response) => {
          if (response && response.success) {
            setCompletionMessage(`Success: ${response.completion}`);
          } else {
            setCompletionMessage(
              `Error: ${response?.completion || 'Consolidation failed.'}`
            );
          }
        }
      );
      setStatusMessage(IDLE_STRING);
    }
  };

  const handleCleanEmptyFolders = () => {
    const confirmed = window.confirm(
      'Are you sure you want to recursively search for and permanently delete all empty bookmark folders?'
    );
    if (!confirmed) return;

    // kick off the empty folder sweep action by sending a message to the background script
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      setStatusMessage('Sweeping tree for empty folders...');
      chrome.runtime.sendMessage(
        { action: 'CLEAN_EMPTY_FOLDERS' },
        (response) => {
          if (response && response.success) {
            setCompletionMessage(`Success: ${response.completion}`);
          } else {
            setCompletionMessage(
              `Error: ${response?.completion || 'Sweep failed.'}`
            );
          }
        }
      );
      setStatusMessage(IDLE_STRING);
    }
  };

  // Render the main UI of the extension popup
  return (
    <div
      style={{
        padding: '16px',
        width: '775px',
        fontFamily: 'sans-serif',
        display: 'flex',
        gap: '24px',
        boxSizing: 'border-box',
        backgroundColor: '#ecf7bd',
        border: '2px solid #7d8364',
      }}
    >
      {/* LEFT COLUMN: All of your existing interactive controls */}
      <div style={{ width: '300px', flexShrink: 0, textAlign: 'left' }}>
        {/* EXCLUSION: Heading 3 alignment can be custom set here (e.g., center) */}
        <h3 style={{ marginTop: 0, textAlign: 'center' }}>
          Ultimate Bookmark Manager
        </h3>

        {/* Source Selection Dropdown Control */}
        <div style={{ marginBottom: '8px' }}>
          <label
            htmlFor="folder-select"
            style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}
          >
            Source Folder (for validation or consolidation):
          </label>
          <select
            id="folder-select"
            value={sourceFolderId}
            onChange={(e) => setSourceFolderId(e.target.value)}
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

        {/* Target Selection Dropdown Control */}
        <div style={{ marginBottom: '8px' }}>
          <label
            htmlFor="target-folder-select"
            style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}
          >
            Target Folder (for consolidation):
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

        {/* Main Validation Button */}
        <button
          onClick={handleValidate}
          disabled={isWorkerRunning || !sourceFolderId}
          style={{
            width: '100%',
            padding: '8px',
            backgroundColor: isWorkerRunning ? '#A0A0A0' : '#5590f1',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isWorkerRunning ? 'not-allowed' : 'pointer',
          }}
        >
          {isWorkerRunning ? 'Working...' : 'Validate Source Folder'}
        </button>

        {/* Consolidate Folders Action Button */}
        <button
          onClick={handleConsolidate}
          disabled={isWorkerRunning || !sourceFolderId || !targetFolderId}
          style={{
            width: '100%',
            padding: '8px',
            marginTop: '8px',
            backgroundColor:
              isWorkerRunning || sourceFolderId === targetFolderId
                ? '#A0A0A0'
                : '#5590f1',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor:
              isWorkerRunning || sourceFolderId === targetFolderId
                ? 'not-allowed'
                : 'pointer',
          }}
        >
          Consolidate Source to Target
        </button>

        {/* Purge Quarantine Folder Action Button */}
        <button
          onClick={handlePurgeBroken}
          disabled={isWorkerRunning}
          style={{
            width: '100%',
            padding: '8px',
            marginTop: '8px',
            backgroundColor: isWorkerRunning ? '#A0A0A0' : '#5590f1',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isWorkerRunning ? 'not-allowed' : 'pointer',
          }}
        >
          Empty Quarantine Folder
        </button>

        {/* Recursive Empty Folder Purge Action Button */}
        <button
          onClick={handleCleanEmptyFolders}
          disabled={isWorkerRunning}
          style={{
            width: '100%',
            padding: '8px',
            marginTop: '8px',
            backgroundColor: isWorkerRunning ? '#A0A0A0' : '#5590f1',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isWorkerRunning ? 'not-allowed' : 'pointer',
          }}
        >
          Delete Empty Bookmark Folders
        </button>

        {/* System Status Message Card */}
        {statusMessage && (
          <div
            style={{
              marginTop: '8px',
              padding: '8px',
              background: '#f4f4f5',
              borderRadius: '4px',
              border: '1px solid #e4e4e7',
              textAlign: 'center',
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
              Extension Status
            </small>
            <p
              style={{
                margin: '4px 0 0 0',
                fontSize: '13px',
                color: '#27272a',
              }}
            >
              {statusMessage}
            </p>
            <p
              style={{
                margin: '4px 0 0 0',
                fontSize: '13px',
                color: '#27272a',
              }}
            >
              {completionMessage}
            </p>
          </div>
        )}

        {/* Persistent Float Timeout Input Configuration */}
        <div style={{ marginBottom: '8px', marginTop: '8px' }}>
          <label
            htmlFor="timeout-input"
            style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}
          >
            Validation Network Timeout (in seconds):
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

        {/* Debug Logging Checkbox Toggle */}
        <div
          style={{
            marginBottom: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <input
            id="debug-logging-toggle"
            type="checkbox"
            checked={isDebugLoggingEnabled}
            onChange={(e) => handleDebugLoggingChange(e.target.checked)}
            disabled={isWorkerRunning}
            style={{ cursor: 'pointer' }}
          />
          <label
            htmlFor="debug-logging-toggle"
            style={{ fontSize: '13px', cursor: 'pointer', userSelect: 'none' }}
          >
            Enable Console Debug Logging
          </label>
        </div>
      </div>

      {/* RIGHT COLUMN: User Guide & Quick Tips */}
      <div
        style={{
          flexGrow: 1,
          borderLeft: '1px solid #e4e4e7',
          paddingLeft: '20px',
          fontSize: '13px',
          color: '#3f3f46',
          lineHeight: '1.5',
          textAlign: 'justify', // Forces all regular description paragraph rows to be full block-justified
        }}
      >
        {/* EXCLUSION: Heading 4 alignment can be custom set here (e.g., center) */}
        <h4 style={{ marginTop: 0, textAlign: 'center' }}>
          User Guide & Quick Tips
        </h4>

        <p>
          <strong>Validate Source Folder:</strong> Scans the selected source
          folder for dead links. Broken items are safely put into a{' '}
          <em>"Broken Bookmarks Quarantine"</em> staging folder rather than
          being deleted instantly. <strong>NOTE: </strong> You should review the
          bookmarks placed in quarantine to see if any were wrongly flagged. You
          can skiplist these pages (or domains) to prevent them from being
          flagged in the future. Will automatically download a
          "bookmark-validation-report.txt" file containing the validation
          results.
        </p>

        <p>
          <strong>Consolidate Source to Target:</strong> Moves all bookmarks
          from your Source folder to the selected Target folder. Not available
          if Source and Target folders are the same.
        </p>

        <p>
          <strong>Empty Quarantine Folder:</strong> Permanently deletes all
          bookmarks contained within the "Broken Bookmarks Quarantine" folder.
          Use with caution, as this action cannot be undone.
        </p>

        <p>
          <strong>Delete Empty Bookmark Folders:</strong> Recursively scans your
          entire browser tree to identify and cleanly delete nested folders
          containing 0 bookmarks or folders.
        </p>

        <p>
          <strong>Skiplisting:</strong> If a known-working bookmark keeps
          getting flagged as broken, open the bookmark and right-click inside
          the page and in the "Ultimate Bookmark Manager" context menu, choose
          "Skip this whole site" to prevent any bookmarks at that site from
          being flagged, or choose "Skip this specific page" to only protect
          that specific page/bookmark. You should also move the skiplisted
          bookmark out of the quarantine folder to avoid accidental deletion.
        </p>
      </div>
    </div>
  );
}

export default App;
