import React from 'react';
import { NoteInlineImageAsset } from '../../utils/noteInlineImages';
import { NoteMarkdownRenderer } from './NoteMarkdownRenderer';

interface NoteMarkdownPreviewProps {
  content: string;
  imageSources: Record<string, NoteInlineImageAsset>;
  onRemoveImage?: (attachmentId: string) => void;
}

export const NoteMarkdownPreview: React.FC<NoteMarkdownPreviewProps> = ({
  content,
  imageSources,
  onRemoveImage,
}) => {
  if (!content.trim()) {
    return <p className="text-sm text-slate-500">La vista previa aparecera aqui.</p>;
  }

  return (
    <div className="prose prose-invert max-w-none">
      <NoteMarkdownRenderer
        content={content}
        imageSources={imageSources}
        variant="preview"
        onRemoveImage={onRemoveImage}
      />
    </div>
  );
};
