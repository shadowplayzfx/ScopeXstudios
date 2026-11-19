import React, { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FileCode2,
  FileJson,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import type { StudioFile } from '../../types/studio';

interface FileTreeProps {
  files: StudioFile[];
  activeFileId: string;
  onSelectFile: (fileId: string) => void;
  onAddFile: (path: string) => void;
  onAddFolder: (folderPath: string) => void;
  onRenameFile: (fileId: string, newPath: string) => void;
  onRenameFolder: (oldPrefix: string, newPrefix: string) => void;
  onDeleteFile: (fileId: string) => void;
  onDeleteFolder: (folderPrefix: string) => void;
}

interface TreeNode {
  name: string;
  fullPath: string;
  isFolder: boolean;
  file?: StudioFile;
  children: TreeNode[];
}

function buildTree(files: StudioFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  const insert = (parts: string[], fullPath: string, file: StudioFile, nodes: TreeNode[], prefix = '') => {
    const [head, ...rest] = parts;
    if (!head) return;
    const currentPath = prefix ? `${prefix}/${head}` : head;

    if (rest.length === 0) {
      nodes.push({
        name: head,
        fullPath: currentPath,
        isFolder: false,
        file,
        children: [],
      });
      return;
    }

    let folderNode = nodes.find((n) => n.isFolder && n.name === head);
    if (!folderNode) {
      folderNode = {
        name: head,
        fullPath: currentPath,
        isFolder: true,
        children: [],
      };
      nodes.push(folderNode);
    }
    insert(rest, fullPath, file, folderNode.children, currentPath);
  };

  for (const file of files) {
    const clean = file.path.replace(/^\/+/, '');
    const parts = clean.split('/').filter(Boolean);
    if (parts.length > 0) {
      insert(parts, clean, file, root);
    }
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.isFolder) sortNodes(n.children);
    }
    return nodes;
  };

  return sortNodes(root);
}

function FileIcon({ name }: { name: string }) {
  if (name.endsWith('.json')) return <FileJson className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  if (name.endsWith('.css') || name.endsWith('.html'))
    return <FileCode2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
  if (name.endsWith('.tsx') || name.endsWith('.ts') || name.endsWith('.jsx') || name.endsWith('.js'))
    return <FileCode2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
  return <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
}

export const FileTree: React.FC<FileTreeProps> = ({
  files,
  activeFileId,
  onSelectFile,
  onAddFile,
  onAddFolder,
  onRenameFile,
  onRenameFolder,
  onDeleteFile,
  onDeleteFolder,
}) => {
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    src: true,
    'src/components': true,
    'src/lib': true,
    'src/utils': true,
    server: true,
  });
  const [creatingMode, setCreatingMode] = useState<'file' | 'folder' | null>(null);
  const [createInput, setCreateInput] = useState('');
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const tree = useMemo(() => buildTree(files), [files]);

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderPath]: prev[folderPath] === undefined ? false : !prev[folderPath],
    }));
  };

  const handleDownloadSingleFile = (file: StudioFile) => {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.path.split('/').pop() || 'file.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleConfirmCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = createInput.trim().replace(/^\/+/, '');
    if (!cleaned) return;
    if (creatingMode === 'file') {
      onAddFile(cleaned);
    } else if (creatingMode === 'folder') {
      onAddFolder(cleaned);
      setExpandedFolders((prev) => ({ ...prev, [cleaned]: true }));
    }
    setCreateInput('');
    setCreatingMode(null);
  };

  const renderNode = (node: TreeNode, depth: number) => {
    if (node.isFolder) {
      const isOpen = expandedFolders[node.fullPath] !== false;
      const isRenaming = renamingKey === `folder:${node.fullPath}`;

      return (
        <div key={`folder:${node.fullPath}`}>
          <div
            style={{ paddingLeft: `${depth * 12 + 6}px` }}
            className="group flex items-center justify-between gap-1 pr-1.5 py-1 rounded text-xs text-slate-300 hover:bg-white/[0.05] cursor-pointer select-none"
            onClick={() => !isRenaming && toggleFolder(node.fullPath)}
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {isOpen ? (
                <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
              )}
              {isOpen ? (
                <FolderOpen className="w-3.5 h-3.5 text-amber-300/90 shrink-0" />
              ) : (
                <Folder className="w-3.5 h-3.5 text-amber-300/80 shrink-0" />
              )}
              {isRenaming ? (
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && renameValue.trim()) {
                      onRenameFolder(node.fullPath, renameValue.trim());
                      setRenamingKey(null);
                    } else if (e.key === 'Escape') {
                      setRenamingKey(null);
                    }
                  }}
                  autoFocus
                  className="w-full bg-[#07090E] border border-blue-500 rounded px-1.5 py-0.5 text-xs font-mono text-white focus:outline-none"
                />
              ) : (
                <span className="truncate font-mono text-[11px]">{node.name}</span>
              )}
            </div>
            {!isRenaming && (
              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  title="New file in folder"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCreatingMode('file');
                    setCreateInput(`${node.fullPath}/`);
                  }}
                  className="p-0.5 text-slate-400 hover:text-white"
                >
                  <FilePlus2 className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  title="Rename folder"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenamingKey(`folder:${node.fullPath}`);
                    setRenameValue(node.fullPath);
                  }}
                  className="p-0.5 text-slate-400 hover:text-white"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  title="Delete folder"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteFolder(node.fullPath);
                  }}
                  className="p-0.5 text-slate-400 hover:text-rose-400"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
          {isOpen && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }

    const file = node.file!;
    const isActive = file.id === activeFileId;
    const isRenaming = renamingKey === `file:${file.id}`;
    const isKeep = node.name === '.keep';

    return (
      <div
        key={file.id}
        style={{ paddingLeft: `${depth * 12 + 18}px` }}
        onClick={() => !isRenaming && onSelectFile(file.id)}
        className={`group flex items-center justify-between gap-1 pr-1.5 py-1 rounded text-xs cursor-pointer transition-colors ${
          isActive
            ? 'bg-blue-600/20 text-blue-300'
            : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <FileIcon name={node.name} />
          {isRenaming ? (
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameValue.trim()) {
                  onRenameFile(file.id, renameValue.trim());
                  setRenamingKey(null);
                } else if (e.key === 'Escape') {
                  setRenamingKey(null);
                }
              }}
              autoFocus
              className="w-full bg-[#07090E] border border-blue-500 rounded px-1.5 py-0.5 text-xs font-mono text-white focus:outline-none"
            />
          ) : (
            <span className={`truncate font-mono text-[11px] ${isKeep ? 'italic text-slate-500' : ''}`}>
              {node.name}
            </span>
          )}
        </div>
        {!isRenaming && (
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              title="Download file"
              onClick={(e) => {
                e.stopPropagation();
                handleDownloadSingleFile(file);
              }}
              className="p-0.5 text-slate-400 hover:text-white"
            >
              <Download className="w-3 h-3" />
            </button>
            <button
              type="button"
              title="Rename file"
              onClick={(e) => {
                e.stopPropagation();
                setRenamingKey(`file:${file.id}`);
                setRenameValue(file.path);
              }}
              className="p-0.5 text-slate-400 hover:text-white"
            >
              <Pencil className="w-3 h-3" />
            </button>
            {files.length > 1 && (
              <button
                type="button"
                title="Delete file"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteFile(file.id);
                }}
                className="p-0.5 text-slate-400 hover:text-rose-400"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-56 bg-[#080B11] border-r border-white/[0.08] flex flex-col shrink-0 select-none">
      <div className="px-3 py-2 flex items-center justify-between border-b border-white/[0.07] shrink-0">
        <span className="text-[11px] font-semibold tracking-wide text-slate-300 uppercase">
          Explorer
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setCreatingMode(creatingMode === 'file' ? null : 'file');
              setCreateInput('src/');
            }}
            title="New file"
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/[0.06]"
          >
            <FilePlus2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setCreatingMode(creatingMode === 'folder' ? null : 'folder');
              setCreateInput('src/components');
            }}
            title="New folder"
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/[0.06]"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {creatingMode && (
        <form
          onSubmit={handleConfirmCreate}
          className="p-2 border-b border-white/[0.07] bg-[#0B0F17] space-y-1.5"
        >
          <div className="text-[10px] font-mono text-slate-400">
            {creatingMode === 'file' ? 'New file path:' : 'New folder path:'}
          </div>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={createInput}
              onChange={(e) => setCreateInput(e.target.value)}
              placeholder={creatingMode === 'file' ? 'src/components/Card.tsx' : 'src/hooks'}
              autoFocus
              className="flex-1 min-w-0 bg-[#07090E] border border-white/15 focus:border-blue-500 rounded px-2 py-1 text-[11px] font-mono text-white focus:outline-none"
            />
            <button
              type="submit"
              title="Create"
              className="p-1 rounded bg-blue-600 hover:bg-blue-500 text-white"
            >
              <Check className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => setCreatingMode(null)}
              title="Cancel"
              className="p-1 rounded bg-white/[0.06] text-slate-300 hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {tree.map((node) => renderNode(node, 0))}
      </div>
    </div>
  );
};
