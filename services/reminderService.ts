// Safely access environment variables to prevent crashes if import.meta.env is undefined

// Updated to the specific API URL provided
const API_URL = (import.meta as any)?.env?.VITE_API_URL || 'https://fast-api-v.onrender.com';
// Updated to the specific Bearer Token provided
const API_BEARER_TOKEN = (import.meta as any)?.env?.VITE_API_BEARER_TOKEN || 's3cr3t-Xjd94jf2kLl';

interface ReminderResponse {
  success: boolean;
  message: string;
  data?: any;
  reminderText?: string;
  whatsappLink?: string;
  whatsappLinkOpened?: boolean;
  errorCode?: string;
}

export interface DailyTopTaskSnapshot {
  id: string;
  title: string;
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  number: number;
  due_date?: string | null;
}

interface DailyTopSyncResponse {
  ok: boolean;
  status: 'updated' | 'unchanged' | 'empty_top5';
  count: number;
  updated_at: string;
}

export const sendReminder = async (
  text: string,
  contextData: { taskId?: string; priority?: number | string; type?: string; dueDate?: string | null }
): Promise<ReminderResponse> => {
  // CAMBIO 1: Loguear la URL correcta
  console.log(`[ReminderService] Sending to ${API_URL}/reminder: "${text}"`, contextData);

  try {
    // CAMBIO 2: Usar la estructura exacta que espera ReminderIn en main.py
    const body = {
      text,
      task_id: contextData.taskId || crypto.randomUUID(),
      priority:
        contextData.priority === undefined || contextData.priority === null
          ? null
          : Number(contextData.priority),
      due_date: contextData.dueDate ?? null,
      type: contextData.type ?? null,
    };

    // CAMBIO 3: Apuntar al endpoint correcto /reminder
    const res = await fetch(`${API_URL}/reminder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_BEARER_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Error ${res.status}: ${errorText}`);
    }

    const data = await res.json();
    const reminderText = data?.reminder_text || data?.reminderText;
    const whatsappLink = data?.whatsapp_link || data?.whatsappLink;

    // El link de WhatsApp se abre desde la UI segun la opcion seleccionada.
    const whatsappLinkOpened = false;

    return {
      success: true,
      message: 'Reminder sent successfully to AI Endpoint',
      data,
      reminderText,
      whatsappLink,
      whatsappLinkOpened,
    };
  } catch (err: any) {
    console.error('Error sending reminder:', err);

    // Fallback message
    return {
      success: false,
      message: `Failed to send: ${err.message || 'Unknown error'}`,
      errorCode: err?.code || undefined,
    };
  }
};

export const syncDailyTopSnapshot = async (
  top5: DailyTopTaskSnapshot[],
  timezone = 'America/Bogota'
): Promise<DailyTopSyncResponse> => {
  const body = {
    top5: (top5 || []).slice(0, 5),
    timezone,
    source: 'todo_web_app',
  };

  const res = await fetch(`${API_URL}/v1/daily-top/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_BEARER_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Error ${res.status}: ${errorText}`);
  }

  return await res.json();
};

export const sendDailyTopNow = async (): Promise<{ ok: boolean; status: string; date: string }> => {
  const res = await fetch(`${API_URL}/v1/daily-top/send-now`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_BEARER_TOKEN}`,
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Error ${res.status}: ${errorText}`);
  }

  return await res.json();
};

// Helper para reintentar abrir el link desde un boton en notificacion / task.
export const tryOpenWhatsAppLink = (link?: string): boolean => {
  if (!link) return false;
  if (typeof window === 'undefined' || typeof window.open !== 'function') return false;
  try {
    const tab = window.open(link, '_blank', 'noopener,noreferrer');
    return !!tab;
  } catch (error) {
    console.warn('No se pudo abrir el link de WhatsApp:', error);
    return false;
  }
};
