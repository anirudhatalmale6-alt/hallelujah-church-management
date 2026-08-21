import React, { useState, useEffect, useRef, Suspense } from 'react';
import { documents, meetingNotes } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { formatStampChurch, fmtServiceDate } from '../utils/format';

// The PDF engine is only fetched the first time someone opens a PDF, so it
// doesn't slow down the rest of the system.
const PdfReader = React.lazy(() => import('../components/PdfReader'));
import {
  FileText, Upload, Search, Download, Trash2, Edit2, X, Eye,
  File, FileImage, FileVideo, FileAudio, FileSpreadsheet, Plus,
  FileArchive, BookOpen, Calendar, Paperclip, Printer, ChevronDown, ChevronUp,
  Save, Clock, User
} from 'lucide-react';

const CATEGORY_LABELS = {
  sermon: 'Sermons',
  meeting_notes: 'Meeting Notes',
  policy: 'Policies',
  form: 'Forms',
  other: 'Other',
};

const CATEGORY_ICONS = {
  sermon: '📖',
  meeting_notes: '📝',
  policy: '📋',
  form: '📄',
  other: '📁',
};

// 'Monday, August 17, 2026' from a plain 'YYYY-MM-DD'. Built from the parts by hand
// because new Date('2026-08-17') is read as UTC midnight, which in Philadelphia is
// the evening BEFORE - so every meeting date printed a day early.
function fmtLongDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return String(dateStr);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(type) {
  if (!type) return <File size={20} className="text-gray-400" />;
  if (type.startsWith('image/')) return <FileImage size={20} className="text-blue-500" />;
  if (type.startsWith('video/')) return <FileVideo size={20} className="text-purple-500" />;
  if (type.startsWith('audio/')) return <FileAudio size={20} className="text-green-500" />;
  if (type.includes('pdf')) return <FileText size={20} className="text-red-500" />;
  if (type.includes('spreadsheet') || type.includes('excel') || type.includes('csv'))
    return <FileSpreadsheet size={20} className="text-green-600" />;
  return <File size={20} className="text-gray-400" />;
}

// Files the browser can show on its own. Anything else (Word, Excel,
// PowerPoint, zip...) has to be downloaded to be opened.
function canPreview(type, name = '') {
  const t = (type || '').toLowerCase();
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (t.includes('pdf') || ext === 'pdf') return 'pdf';
  if (t.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  if (t.startsWith('video/') || ['mp4', 'webm', 'ogg', 'mov'].includes(ext)) return 'video';
  if (t.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac'].includes(ext)) return 'audio';
  if (t.startsWith('text/') || ['txt', 'csv', 'log', 'md'].includes(ext)) return 'text';
  return null;
}

// ===================== FILE VIEWER =====================
// Opens a document inside the system - no download, no leaving the page.
function FileViewer({ file, onClose }) {
  if (!file) return null;
  const kind = canPreview(file.type, file.name);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-2 sm:p-6" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-gray-50">
          <FileText size={18} className="text-primary-700 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-gray-900 truncate">{file.title}</div>
            <div className="text-xs text-gray-500 truncate">{file.name}</div>
          </div>
          <a href={file.downloadUrl} target="_blank" rel="noreferrer"
            className="btn btn-sm bg-gray-100 text-gray-700 hover:bg-gray-200 flex items-center gap-1" title="Download a copy">
            <Download size={14} /> <span className="hidden sm:inline">Download</span>
          </a>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1" title="Close">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 bg-gray-100 overflow-auto">
          {kind === 'pdf' ? (
            <Suspense fallback={
              <div className="w-full h-full flex items-center justify-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700" />
              </div>
            }>
              <PdfReader url={file.viewUrl} printUrl={file.viewUrl} />
            </Suspense>
          ) : kind === 'text' ? (
            <iframe src={file.viewUrl} title={file.title} className="w-full h-full border-0" />
          ) : kind === 'image' ? (
            <div className="w-full h-full flex items-center justify-center p-4">
              <img src={file.viewUrl} alt={file.title} className="max-w-full max-h-full object-contain" />
            </div>
          ) : kind === 'video' ? (
            <div className="w-full h-full flex items-center justify-center bg-black p-2">
              <video src={file.viewUrl} controls className="max-w-full max-h-full" />
            </div>
          ) : kind === 'audio' ? (
            <div className="w-full h-full flex items-center justify-center p-6">
              <audio src={file.viewUrl} controls className="w-full max-w-lg" />
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-center p-8 gap-3">
              <File size={48} className="text-gray-300" />
              <div className="text-gray-700 font-medium">This file type can't be shown in the browser</div>
              <div className="text-sm text-gray-500 max-w-md">
                Word, Excel, PowerPoint and zip files need to be opened in their own program.
                PDFs, images, videos and audio open right here.
              </div>
              <a href={file.downloadUrl} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm mt-2 flex items-center gap-1">
                <Download size={14} /> Download this file
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===================== NOTE READER =====================
// A typed note is text, not a file, so it gets its own reader rather than being
// pushed through the file viewer. Print here matches the meeting-note print sheet.
function NoteReader({ note, onClose, onEdit }) {
  if (!note) return null;

  const printNote = () => {
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(note.title)}</title><style>
      body { font-family: Georgia, serif; max-width: 800px; margin: 40px auto; padding: 20px; color: #222; }
      h1 { font-size: 24px; margin-bottom: 4px; }
      .meta { color: #666; font-size: 14px; margin-bottom: 20px; border-bottom: 2px solid #1a365d; padding-bottom: 10px; }
      .content { white-space: pre-wrap; line-height: 1.6; }
      .footer { margin-top: 40px; border-top: 1px solid #ccc; padding-top: 10px; font-size: 12px; color: #999; }
      @media print { body { margin: 0; } }
    </style></head><body>
      <h1>${esc(note.title)}</h1>
      <div class="meta">${esc(CATEGORY_LABELS[note.category] || note.category)} | By: ${esc(note.uploaded_by_name || '')} | ${formatStampChurch(note.created_at, { year: 'numeric', month: 'long', day: 'numeric', hour: undefined, minute: undefined })}</div>
      ${note.description ? `<p><em>${esc(note.description)}</em></p>` : ''}
      <div class="content">${esc(note.note_content)}</div>
      <div class="footer">Hallelujah In The City</div>
    </body></html>`);
    w.document.close();
    w.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-2 sm:p-6" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-gray-50">
          <BookOpen size={18} className="text-primary-700 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-gray-900 truncate">{note.title}</div>
            <div className="text-xs text-gray-500 truncate">
              {CATEGORY_LABELS[note.category] || note.category} &middot; by {note.uploaded_by_name} &middot; {formatStampChurch(note.created_at)}
            </div>
          </div>
          <button onClick={() => onEdit(note)} className="btn btn-sm bg-gray-100 text-gray-700 hover:bg-gray-200 flex items-center gap-1" title="Edit this note">
            <Edit2 size={14} /> <span className="hidden sm:inline">Edit</span>
          </button>
          <button onClick={printNote} className="btn btn-sm bg-gray-100 text-gray-700 hover:bg-gray-200 flex items-center gap-1" title="Print">
            <Printer size={14} /> <span className="hidden sm:inline">Print</span>
          </button>
          <a href={documents.downloadUrl(note.id)} target="_blank" rel="noreferrer"
            className="btn btn-sm bg-gray-100 text-gray-700 hover:bg-gray-200 flex items-center gap-1" title="Download a copy">
            <Download size={14} /> <span className="hidden sm:inline">Download</span>
          </a>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1" title="Close">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-6">
          {note.description && <p className="text-sm text-gray-500 italic mb-4">{note.description}</p>}
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-gray-800">
            {note.note_content || <span className="text-gray-400">This note is empty.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===================== DOCUMENTS TAB =====================
function DocumentsTab() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState([]);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', category: '', description: '' });
  const [viewing, setViewing] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkMoving, setBulkMoving] = useState(false);

  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadCategory, setUploadCategory] = useState('other');
  const [uploadDescription, setUploadDescription] = useState('');
  const fileRef = useRef(null);

  // Typed notes: write one here instead of uploading a file someone typed elsewhere.
  const emptyNote = { title: '', category: 'sermon', description: '', content: '' };
  const [showNote, setShowNote] = useState(false);
  const [noteForm, setNoteForm] = useState(emptyNote);
  const [noteEditId, setNoteEditId] = useState(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [readingNote, setReadingNote] = useState(null);

  const openNewNote = () => {
    setNoteEditId(null);
    setNoteForm(emptyNote);
    setNoteError('');
    setShowNote(true);
  };

  const openNoteReader = async (id) => {
    try {
      const res = await documents.getNote(id);
      setReadingNote(res.note);
    } catch (err) {
      alert(err.message || 'Could not open this note');
    }
  };

  const openEditNote = async (note) => {
    // The list only carries a preview of the text, so fetch the full note first -
    // otherwise saving would silently truncate it to the preview.
    let full = note;
    if (note.note_content === undefined) {
      try {
        const res = await documents.getNote(note.id);
        full = res.note;
      } catch (err) {
        alert(err.message || 'Could not open this note');
        return;
      }
    }
    setReadingNote(null);
    setNoteEditId(full.id);
    setNoteForm({
      title: full.title || '',
      category: full.category || 'other',
      description: full.description || '',
      content: full.note_content || '',
    });
    setNoteError('');
    setShowNote(true);
  };

  const saveNote = async () => {
    if (!noteForm.title.trim() || noteSaving) return;
    setNoteSaving(true);
    setNoteError('');
    try {
      if (noteEditId) {
        await documents.updateNote(noteEditId, noteForm);
      } else {
        await documents.createNote(noteForm);
      }
      setShowNote(false);
      setNoteEditId(null);
      setNoteForm(emptyNote);
      load();
    } catch (err) {
      setNoteError(err.message || 'Could not save the note');
    }
    setNoteSaving(false);
  };

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterCat) params.category = filterCat;
      if (search) params.search = search;
      const res = await documents.list(params);
      setDocs(res.documents || []);
      setSelectedIds([]);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [filterCat]);

  useEffect(() => {
    const timer = setTimeout(() => load(), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (uploadFiles.length === 0) return;
    setUploading(true);
    const progress = uploadFiles.map((f) => ({ name: f.name, status: 'pending' }));
    setUploadProgress([...progress]);

    for (let i = 0; i < uploadFiles.length; i++) {
      progress[i].status = 'uploading';
      setUploadProgress([...progress]);
      try {
        const title = uploadFiles[i].name.replace(/\.[^/.]+$/, '');
        await documents.upload(uploadFiles[i], title, uploadCategory, uploadDescription);
        progress[i].status = 'done';
      } catch {
        progress[i].status = 'error';
      }
      setUploadProgress([...progress]);
    }

    setTimeout(() => {
      setShowUpload(false);
      setUploadFiles([]);
      setUploadCategory('other');
      setUploadDescription('');
      setUploadProgress([]);
      load();
    }, 1000);
    setUploading(false);
  };

  const handleEdit = (doc) => {
    setEditing(doc.id);
    setEditForm({ title: doc.title, category: doc.category, description: doc.description || '' });
  };

  const handleSaveEdit = async () => {
    try {
      await documents.update(editing, editForm);
      setEditing(null);
      load();
    } catch (err) {
      alert(err.message || 'Update failed');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this document? The file will be permanently removed.')) return;
    try {
      await documents.delete(id);
      load();
    } catch (err) {
      alert(err.message || 'Delete failed');
    }
  };

  const toggleOne = (id) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const allSelected = docs.length > 0 && docs.every(d => selectedIds.includes(d.id));
  const toggleAll = () =>
    setSelectedIds(allSelected ? [] : docs.map(d => d.id));

  const handleBulkDelete = async () => {
    if (!selectedIds.length) return;
    const n = selectedIds.length;
    if (!confirm(`Delete ${n} selected ${n === 1 ? 'document' : 'documents'}? The files will be permanently removed.`)) return;
    setBulkDeleting(true);
    try {
      await documents.bulkDelete(selectedIds);
      load();
    } catch (err) {
      alert(err.message || 'Delete failed');
    }
    setBulkDeleting(false);
  };

  // Move the whole selection into another folder. One file at a time still works
  // through Edit; this is for when there are twenty of them.
  const handleBulkMove = async (category) => {
    if (!category || !selectedIds.length) return;
    const n = selectedIds.length;
    const label = CATEGORY_LABELS[category] || category;
    if (!confirm(`Move ${n} ${n === 1 ? 'item' : 'items'} into ${label}?`)) return;
    setBulkMoving(true);
    try {
      const res = await documents.bulkMove(selectedIds, category);
      setSelectedIds([]);
      await load();
      alert(res.message ? `${res.message} into ${label}.` : 'Moved.');
    } catch (err) {
      alert(err.message || 'Move failed');
    }
    setBulkMoving(false);
  };

  const categoryCounts = {};
  docs.forEach(d => { categoryCounts[d.category] = (categoryCounts[d.category] || 0) + 1; });

  return (
    <div>
      {/* Category cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <button
          onClick={() => setFilterCat('')}
          className={`card p-3 text-center transition-colors cursor-pointer ${!filterCat ? 'ring-2 ring-primary-500' : ''}`}
        >
          <div className="text-2xl mb-1">📂</div>
          <div className="text-xs font-medium text-gray-700">All</div>
          <div className="text-lg font-bold text-gray-900">{docs.length}</div>
        </button>
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilterCat(filterCat === key ? '' : key)}
            className={`card p-3 text-center transition-colors cursor-pointer ${filterCat === key ? 'ring-2 ring-primary-500' : ''}`}
          >
            <div className="text-2xl mb-1">{CATEGORY_ICONS[key]}</div>
            <div className="text-xs font-medium text-gray-700">{label}</div>
            <div className="text-lg font-bold text-gray-900">{categoryCounts[key] || 0}</div>
          </button>
        ))}
      </div>

      {/* Search + Upload button */}
      <div className="card p-4 mb-4">
        <div className="flex gap-3 items-center">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              className="input pl-9" placeholder="Search documents..."
            />
          </div>
          {/* There is no bare `.btn` rule in index.css, so the layout utilities have to
              be spelled out here or the icon and the label land on separate lines. */}
          <button onClick={openNewNote}
            className="inline-flex items-center gap-2 whitespace-nowrap flex-shrink-0 font-medium py-2 px-4 rounded-lg transition-colors duration-200 bg-green-50 text-green-700 hover:bg-green-100 border border-green-200">
            <Plus size={14} /> New Note
          </button>
          <button onClick={() => setShowUpload(true)} className="btn btn-primary whitespace-nowrap flex-shrink-0">
            <Upload size={14} /> Upload Files
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Upload Files is for something already written elsewhere. New Note lets you type
          it here - a sermon, a policy, anything - and it is saved in the folder you pick,
          searchable by its words, and editable afterwards.
        </p>
      </div>

      {/* New / Edit typed note */}
      {showNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !noteSaving && setShowNote(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-bold">{noteEditId ? 'Edit Note' : 'New Note'}</h3>
              <button onClick={() => !noteSaving && setShowNote(false)} disabled={noteSaving} className="text-gray-400 hover:text-gray-600 disabled:opacity-40"><X size={20} /></button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                  <input type="text" value={noteForm.title} autoFocus
                    onChange={e => setNoteForm(f => ({ ...f, title: e.target.value }))}
                    className="input" placeholder="e.g. Sunday sermon - The Good Shepherd" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Folder</label>
                  <select value={noteForm.category} onChange={e => setNoteForm(f => ({ ...f, category: e.target.value }))} className="input">
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Short description (optional)</label>
                <input type="text" value={noteForm.description}
                  onChange={e => setNoteForm(f => ({ ...f, description: e.target.value }))}
                  className="input" placeholder="One line, shown under the title in the list" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
                <textarea value={noteForm.content}
                  onChange={e => setNoteForm(f => ({ ...f, content: e.target.value }))}
                  className="input text-sm" rows={14}
                  placeholder="Type the sermon, the policy, the notes... Anything you type here is saved and can be edited later." />
              </div>
              {noteError && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{noteError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowNote(false)} disabled={noteSaving} className="btn bg-gray-100 text-gray-700 disabled:opacity-50">Cancel</button>
                <button onClick={saveNote} disabled={!noteForm.title.trim() || noteSaving} className="btn btn-primary disabled:opacity-60">
                  <Save size={14} /> {noteSaving ? 'Saving...' : (noteEditId ? 'Update Note' : 'Save Note')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload modal - supports multiple files */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !uploading && setShowUpload(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-bold">Upload Documents</h3>
              {!uploading && <button onClick={() => setShowUpload(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>}
            </div>
            <form onSubmit={handleUpload} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Files (select multiple)</label>
                <input
                  ref={fileRef} type="file" multiple
                  onChange={e => {
                    setUploadFiles(Array.from(e.target.files));
                  }}
                  className="input"
                />
                {uploadFiles.length > 1 && (
                  <p className="text-xs text-blue-600 mt-1">{uploadFiles.length} files selected</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category (for all files)</label>
                <select value={uploadCategory} onChange={e => setUploadCategory(e.target.value)} className="input">
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional, shared)</label>
                <textarea value={uploadDescription} onChange={e => setUploadDescription(e.target.value)}
                  className="input" rows={2} placeholder="Brief description..." />
              </div>

              {/* Upload progress */}
              {uploadProgress.length > 0 && (
                <div className="space-y-1 border rounded-lg p-3 bg-gray-50">
                  {uploadProgress.map((p, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      {p.status === 'pending' && <div className="w-3 h-3 rounded-full bg-gray-300" />}
                      {p.status === 'uploading' && <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />}
                      {p.status === 'done' && <div className="w-3 h-3 rounded-full bg-green-500" />}
                      {p.status === 'error' && <div className="w-3 h-3 rounded-full bg-red-500" />}
                      <span className="truncate">{p.name}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => !uploading && setShowUpload(false)} disabled={uploading} className="btn bg-gray-100 text-gray-700">Cancel</button>
                <button type="submit" disabled={uploadFiles.length === 0 || uploading} className="btn btn-primary">
                  {uploading ? 'Uploading...' : `Upload ${uploadFiles.length > 1 ? uploadFiles.length + ' Files' : 'File'}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Documents list */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : docs.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No documents found</div>
        ) : (
          <div className="divide-y">
            <div className="flex items-center gap-4 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-4 w-4 rounded border-gray-300 text-primary-700 focus:ring-primary-500 cursor-pointer"
                title="Select all"
              />
              {selectedIds.length > 0 ? (
                <>
                  <span className="text-sm font-medium text-primary-800">{selectedIds.length} selected</span>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <label className="text-sm text-gray-600">Move to</label>
                    <select
                      value=""
                      disabled={bulkMoving}
                      onChange={e => { const v = e.target.value; e.target.value = ''; handleBulkMove(v); }}
                      className="input text-sm w-auto py-1.5"
                    >
                      <option value="">{bulkMoving ? 'Moving...' : 'Choose folder...'}</option>
                      {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <button onClick={() => setSelectedIds([])} className="btn-secondary text-sm">Clear</button>
                    <button onClick={handleBulkDelete} disabled={bulkDeleting} className="btn-danger text-sm">
                      <Trash2 size={14} /> {bulkDeleting ? 'Deleting...' : 'Delete selected'}
                    </button>
                  </div>
                </>
              ) : (
                <span className="text-xs text-gray-500">Select all &mdash; then move or delete them together</span>
              )}
            </div>
            {docs.map(doc => (
              <div key={doc.id} className={`flex items-center gap-4 px-4 py-3 ${selectedIds.includes(doc.id) ? 'bg-primary-50' : 'hover:bg-gray-50'}`}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(doc.id)}
                  onChange={() => toggleOne(doc.id)}
                  className="h-4 w-4 rounded border-gray-300 text-primary-700 focus:ring-primary-500 cursor-pointer flex-shrink-0"
                />
                <div className="flex-shrink-0">
                  {Number(doc.is_note) === 1
                    ? <BookOpen size={20} className="text-green-600" />
                    : getFileIcon(doc.file_type)}
                </div>
                <div className="flex-1 min-w-0">
                  {editing === doc.id ? (
                    <div className="space-y-2">
                      <input type="text" value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                        className="input text-sm" />
                      <div className="flex gap-2">
                        <select value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} className="input text-sm w-auto">
                          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <button onClick={handleSaveEdit} className="btn btn-primary btn-sm">Save</button>
                        <button onClick={() => setEditing(null)} className="btn btn-sm bg-gray-100 text-gray-600">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => Number(doc.is_note) === 1
                          ? openNoteReader(doc.id)
                          : setViewing({
                              title: doc.title, name: doc.file_name, type: doc.file_type,
                              viewUrl: documents.viewUrl(doc.id), downloadUrl: documents.downloadUrl(doc.id),
                            })}
                        className="font-medium text-gray-900 truncate hover:text-primary-700 hover:underline text-left w-full"
                        title={Number(doc.is_note) === 1 ? 'Click to read this note' : 'Click to read this document'}
                      >
                        {doc.title}
                      </button>
                      <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                        <span className="px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">
                          {CATEGORY_LABELS[doc.category] || doc.category}
                        </span>
                        {Number(doc.is_note) === 1 ? (
                          <span className="px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">Note</span>
                        ) : (
                          <>
                            <span>{formatSize(doc.file_size)}</span>
                            <span>{doc.file_name}</span>
                          </>
                        )}
                        <span>by {doc.uploaded_by_name}</span>
                        <span>{formatStampChurch(doc.created_at)}</span>
                      </div>
                      {doc.description && <div className="text-xs text-gray-500 mt-1">{doc.description}</div>}
                      {Number(doc.is_note) === 1 && doc.note_preview && !doc.description && (
                        <div className="text-xs text-gray-500 mt-1 truncate">{doc.note_preview}</div>
                      )}
                    </>
                  )}
                </div>
                {editing !== doc.id && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => Number(doc.is_note) === 1
                        ? openNoteReader(doc.id)
                        : setViewing({
                            title: doc.title, name: doc.file_name, type: doc.file_type,
                            viewUrl: documents.viewUrl(doc.id), downloadUrl: documents.downloadUrl(doc.id),
                          })}
                      className="text-primary-700 hover:text-primary-900" title="View in the system">
                      <Eye size={17} />
                    </button>
                    <a href={documents.downloadUrl(doc.id)} target="_blank" rel="noreferrer"
                      className="text-blue-600 hover:text-blue-800" title="Download">
                      <Download size={16} />
                    </a>
                    <button
                      onClick={() => Number(doc.is_note) === 1 ? openEditNote(doc) : handleEdit(doc)}
                      className="text-gray-400 hover:text-blue-600"
                      title={Number(doc.is_note) === 1 ? 'Edit this note' : 'Edit'}>
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => handleDelete(doc.id)} className="text-gray-400 hover:text-red-600" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <FileViewer file={viewing} onClose={() => setViewing(null)} />
      <NoteReader note={readingNote} onClose={() => setReadingNote(null)} onEdit={openEditNote} />
    </div>
  );
}

// ===================== MEETING NOTES TAB =====================
function MeetingNotesTab() {
  const { user } = useAuth();
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedNote, setExpandedNote] = useState(null);
  const [loadingNote, setLoadingNote] = useState(false);
  const [attachUploading, setAttachUploading] = useState(false);
  const [viewingAtt, setViewingAtt] = useState(null);
  const attachRef = useRef(null);

  const emptyForm = { title: '', meeting_date: new Date().toISOString().split('T')[0], subjects: [''], content: '' };
  const [form, setForm] = useState(emptyForm);
  // Files chosen inside the New Note form. An attachment needs a note id, so these
  // are held here and uploaded the moment the note is saved - previously you had to
  // save the note, find it in the list, open it, and only then attach anything.
  const [formFiles, setFormFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const formFileRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      const res = await meetingNotes.list(params);
      setNotes(res.notes || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const timer = setTimeout(() => load(), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadNote = async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedNote(null);
      return;
    }
    setExpandedId(id);
    setLoadingNote(true);
    try {
      const res = await meetingNotes.view(id);
      setExpandedNote(res.note);
    } catch {}
    setLoadingNote(false);
  };

  const openEdit = (note) => {
    setEditingId(note.id);
    setForm({
      title: note.title,
      meeting_date: note.meeting_date,
      subjects: (note.subjects && note.subjects.length > 0) ? note.subjects : [''],
      content: note.content || '',
    });
    setFormFiles([]);
    setFormError('');
    setShowForm(true);
  };

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormFiles([]);
    setFormError('');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (saving) return;
    const subjects = form.subjects.filter(s => s.trim());
    const payload = { ...form, subjects };
    setSaving(true);
    setFormError('');
    try {
      let noteId = editingId;
      if (editingId) {
        await meetingNotes.update(editingId, payload);
      } else {
        const res = await meetingNotes.create(payload);
        noteId = res.id || res.note_id;
      }

      // Attach whatever was picked in the form. A file that fails is reported by
      // name rather than swallowed, so nobody thinks it went up when it did not.
      const failed = [];
      if (noteId && formFiles.length) {
        for (const file of formFiles) {
          try {
            await meetingNotes.uploadAttachment(noteId, file);
          } catch {
            failed.push(file.name);
          }
        }
      }

      if (failed.length) {
        setFormError(`The note was saved, but these files did not upload: ${failed.join(', ')}. You can attach them again from the note itself.`);
        setFormFiles([]);
        if (formFileRef.current) formFileRef.current.value = '';
        load();
        setSaving(false);
        return;
      }

      setShowForm(false);
      const wasEditing = editingId;
      setEditingId(null);
      setForm(emptyForm);
      setFormFiles([]);
      if (formFileRef.current) formFileRef.current.value = '';
      load();
      if (expandedId && expandedId === (wasEditing || noteId)) {
        const res = await meetingNotes.view(expandedId);
        setExpandedNote(res.note);
      }
    } catch (err) {
      setFormError(err.message || 'Save failed');
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this meeting note and all its attachments?')) return;
    try {
      await meetingNotes.delete(id);
      if (expandedId === id) { setExpandedId(null); setExpandedNote(null); }
      load();
    } catch (err) {
      alert(err.message || 'Delete failed');
    }
  };

  const handleAttachUpload = async (noteId) => {
    const files = attachRef.current?.files;
    if (!files || files.length === 0) return;
    setAttachUploading(true);
    for (const file of files) {
      try {
        await meetingNotes.uploadAttachment(noteId, file);
      } catch {}
    }
    attachRef.current.value = '';
    setAttachUploading(false);
    const res = await meetingNotes.view(noteId);
    setExpandedNote(res.note);
  };

  const handleAttachDelete = async (attId, noteId) => {
    if (!confirm('Delete this attachment?')) return;
    try {
      await meetingNotes.deleteAttachment(attId);
      const res = await meetingNotes.view(noteId);
      setExpandedNote(res.note);
    } catch {}
  };

  const handlePrint = (note) => {
    const subjects = note.subjects || [];
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><title>${note.title}</title><style>
      body { font-family: Georgia, serif; max-width: 800px; margin: 40px auto; padding: 20px; color: #222; }
      h1 { font-size: 24px; margin-bottom: 4px; }
      .meta { color: #666; font-size: 14px; margin-bottom: 20px; border-bottom: 2px solid #1a365d; padding-bottom: 10px; }
      .subjects { margin-bottom: 20px; }
      .subjects h3 { font-size: 16px; margin-bottom: 8px; color: #1a365d; }
      .subjects ul { padding-left: 20px; }
      .subjects li { margin-bottom: 4px; }
      .content { white-space: pre-wrap; line-height: 1.6; }
      .footer { margin-top: 40px; border-top: 1px solid #ccc; padding-top: 10px; font-size: 12px; color: #999; }
      @media print { body { margin: 0; } }
    </style></head><body>
      <h1>${note.title}</h1>
      <div class="meta">Date: ${fmtLongDate(note.meeting_date)} | By: ${note.created_by_name || 'Unknown'}</div>
      ${subjects.length > 0 ? `<div class="subjects"><h3>Subjects</h3><ul>${subjects.map(s => `<li>${s}</li>`).join('')}</ul></div>` : ''}
      <div class="content">${(note.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
      <div class="footer">Hallelujah In The City - Meeting Notes</div>
    </body></html>`);
    w.document.close();
    w.print();
  };

  return (
    <div>
      {/* Search + New Note */}
      <div className="card p-4 mb-4">
        <div className="flex gap-3 items-center">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              className="input pl-9" placeholder="Search meeting notes..."
            />
          </div>
          <button onClick={openNew} className="btn btn-primary whitespace-nowrap">
            <Plus size={14} /> New Note
          </button>
        </div>
      </div>

      {/* New / Edit Note Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !saving && setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-bold">{editingId ? 'Edit Meeting Note' : 'New Meeting Note'}</h3>
              <button onClick={() => !saving && setShowForm(false)} disabled={saving} className="text-gray-400 hover:text-gray-600 disabled:opacity-40"><X size={20} /></button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                  <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    className="input" placeholder="e.g. Board Meeting - June 2026" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Meeting Date</label>
                  <input type="date" value={form.meeting_date} onChange={e => setForm(f => ({ ...f, meeting_date: e.target.value }))}
                    className="input" />
                </div>
              </div>

              {/* Subjects */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subjects / Agenda Items</label>
                {form.subjects.map((subj, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input
                      type="text" value={subj}
                      onChange={e => {
                        const s = [...form.subjects];
                        s[i] = e.target.value;
                        setForm(f => ({ ...f, subjects: s }));
                      }}
                      className="input flex-1" placeholder={`Subject ${i + 1}`}
                    />
                    {form.subjects.length > 1 && (
                      <button type="button" onClick={() => {
                        const s = form.subjects.filter((_, j) => j !== i);
                        setForm(f => ({ ...f, subjects: s }));
                      }} className="text-red-400 hover:text-red-600 px-2"><X size={16} /></button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => setForm(f => ({ ...f, subjects: [...f.subjects, ''] }))}
                  className="text-sm text-blue-600 hover:text-blue-800">+ Add Subject</button>
              </div>

              {/* Content */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes / Content</label>
                <textarea
                  value={form.content}
                  onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  className="input font-mono text-sm"
                  rows={12}
                  placeholder="Type your meeting notes here..."
                />
              </div>

              {/* Attach files right here, instead of having to save first and come back */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Attach files (optional)</label>
                <input ref={formFileRef} type="file" multiple
                  onChange={e => setFormFiles(Array.from(e.target.files))}
                  className="input" />
                {formFiles.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {formFiles.map((f, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs text-gray-600">
                        <Paperclip size={12} className="text-gray-400" />
                        <span className="truncate">{f.name}</span>
                        <span className="text-gray-400">{formatSize(f.size)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-500 mt-1">
                    Pick as many as you like - agendas, photos, a signed sheet. They upload
                    as soon as the note is saved, and you can add more later from the note itself.
                  </p>
                )}
              </div>

              {formError && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowForm(false)} disabled={saving} className="btn bg-gray-100 text-gray-700 disabled:opacity-50">Cancel</button>
                <button onClick={handleSave} disabled={!form.title || !form.meeting_date || saving} className="btn btn-primary disabled:opacity-60">
                  <Save size={14} /> {saving
                    ? (formFiles.length ? 'Saving and uploading...' : 'Saving...')
                    : (editingId ? 'Update Note' : 'Save Note')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notes list */}
      {loading ? (
        <div className="card p-8 text-center text-gray-400">Loading...</div>
      ) : notes.length === 0 ? (
        <div className="card p-8 text-center text-gray-400">
          <BookOpen size={40} className="mx-auto mb-3 text-gray-300" />
          <p>No meeting notes yet</p>
          <button onClick={openNew} className="btn btn-primary mt-3"><Plus size={14} /> Create First Note</button>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map(note => (
            <div key={note.id} className="card overflow-hidden">
              <div
                className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50"
                onClick={() => loadNote(note.id)}
              >
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                    <BookOpen size={20} className="text-blue-600" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900">{note.title}</div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap mt-1">
                    <span className="flex items-center gap-1"><Calendar size={12} /> {fmtServiceDate(note.meeting_date)}</span>
                    <span className="flex items-center gap-1"><User size={12} /> {note.created_by_name}</span>
                    {note.subjects && note.subjects.length > 0 && (
                      <span>{note.subjects.length} subject{note.subjects.length > 1 ? 's' : ''}</span>
                    )}
                    {note.attachment_count > 0 && (
                      <span className="flex items-center gap-1"><Paperclip size={12} /> {note.attachment_count} file{note.attachment_count > 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={e => { e.stopPropagation(); openEdit(note); }} className="text-gray-400 hover:text-blue-600" title="Edit">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); handlePrint(expandedNote || note); }} className="text-gray-400 hover:text-blue-600" title="Print">
                    <Printer size={14} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); handleDelete(note.id); }} className="text-gray-400 hover:text-red-600" title="Delete">
                    <Trash2 size={14} />
                  </button>
                  {expandedId === note.id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </div>
              </div>

              {/* Expanded view */}
              {expandedId === note.id && (
                <div className="border-t">
                  {loadingNote ? (
                    <div className="p-4 text-center text-gray-400">Loading...</div>
                  ) : expandedNote ? (
                    <div className="p-4 space-y-4">
                      {/* Subjects */}
                      {expandedNote.subjects && expandedNote.subjects.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-2">Subjects / Agenda</h4>
                          <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                            {expandedNote.subjects.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>
                      )}

                      {/* Content */}
                      {expandedNote.content && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-2">Notes</h4>
                          <div className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-4 leading-relaxed">
                            {expandedNote.content}
                          </div>
                        </div>
                      )}

                      {/* Attachments */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-semibold text-gray-700">Attachments</h4>
                          <label className="btn btn-sm bg-gray-100 text-gray-700 cursor-pointer">
                            <Paperclip size={12} /> Attach File
                            <input
                              ref={attachRef}
                              type="file"
                              multiple
                              className="hidden"
                              onChange={() => handleAttachUpload(note.id)}
                            />
                          </label>
                        </div>
                        {attachUploading && <div className="text-xs text-blue-600 mb-2">Uploading...</div>}
                        {expandedNote.attachments && expandedNote.attachments.length > 0 ? (
                          <div className="space-y-2">
                            {expandedNote.attachments.map(att => (
                              <div key={att.id} className="flex items-center gap-3 text-sm bg-gray-50 rounded-lg px-3 py-2">
                                {getFileIcon(att.file_type)}
                                <div className="flex-1 min-w-0">
                                  <button
                                    onClick={() => setViewingAtt({
                                      title: att.file_name, name: att.file_name, type: att.file_type,
                                      viewUrl: meetingNotes.attachmentViewUrl(att.id),
                                      downloadUrl: meetingNotes.attachmentDownloadUrl(att.id),
                                    })}
                                    className="truncate font-medium text-gray-700 hover:text-primary-700 hover:underline text-left w-full"
                                    title="Click to view">
                                    {att.file_name}
                                  </button>
                                  <div className="text-xs text-gray-500">{formatSize(att.file_size)} - {att.uploaded_by_name}</div>
                                </div>
                                <button
                                  onClick={() => setViewingAtt({
                                    title: att.file_name, name: att.file_name, type: att.file_type,
                                    viewUrl: meetingNotes.attachmentViewUrl(att.id),
                                    downloadUrl: meetingNotes.attachmentDownloadUrl(att.id),
                                  })}
                                  className="text-primary-700 hover:text-primary-900" title="View in the system"><Eye size={15} /></button>
                                <a href={meetingNotes.attachmentDownloadUrl(att.id)} target="_blank" rel="noreferrer"
                                  className="text-blue-600 hover:text-blue-800"><Download size={14} /></a>
                                <button onClick={() => handleAttachDelete(att.id, note.id)}
                                  className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400">No attachments</p>
                        )}
                      </div>

                      {/* Meta */}
                      <div className="text-xs text-gray-400 pt-2 border-t flex gap-4 flex-wrap">
                        <span>Created: {formatStampChurch(expandedNote.created_at)}</span>
                        {expandedNote.updated_by_name && <span>Last edited by: {expandedNote.updated_by_name} at {formatStampChurch(expandedNote.updated_at)}</span>}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <FileViewer file={viewingAtt} onClose={() => setViewingAtt(null)} />
    </div>
  );
}

// ===================== MAIN PAGE =====================
export default function DocumentsPage() {
  const [tab, setTab] = useState('documents');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Documents & Notes</h1>
          <p className="text-sm text-gray-500">File storage, meeting notes, and records</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('documents')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
            tab === 'documents' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <FileArchive size={16} /> Documents
        </button>
        <button
          onClick={() => setTab('notes')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
            tab === 'notes' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <BookOpen size={16} /> Meeting Notes
        </button>
      </div>

      {tab === 'documents' ? <DocumentsTab /> : <MeetingNotesTab />}
    </div>
  );
}
