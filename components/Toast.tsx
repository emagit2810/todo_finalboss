
import React, { useEffect } from 'react';
import { CheckIcon, XMarkIcon } from './Icons';

interface ToastProps {
  message: string;
  type: 'success' | 'error';
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`
      fixed top-4 left-1/2 transform -translate-x-1/2 z-[100]
      flex items-center gap-3 px-4 py-3 rounded-lg shadow-2xl border
      animate-in slide-in-from-top-5 duration-300
      ${type === 'success' 
        ? 'bg-emerald-900/90 border-emerald-500 text-emerald-100' 
        : 'bg-red-900/90 border-red-500 text-red-100'
      }
    `}>
      <div className={`
        w-2 h-2 rounded-full animate-pulse
        ${type === 'success' ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]' : 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.8)]'}
      `} />
      
      <span className="font-medium text-sm">{message}</span>
      
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100">
        <XMarkIcon className="w-4 h-4" />
      </button>
    </div>
  );
};
