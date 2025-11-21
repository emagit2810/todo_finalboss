
// Environment helpers (no fallback secrets in producción)
const API_URL =
  (import.meta as any)?.env?.VITE_API_URL ||
  'https://fast-api-v.onrender.com';

const API_BEARER_TOKEN = 's3cr3t-Xjd94jf2kLl';

interface ReminderResponse {
  success: boolean;
  message: string;
  data?: any;
  reminderText?: string;
}

export const sendReminder = async (
  text: string, 
  contextData: { taskId?: string; priority?: string | number; type: 'TODO' | 'MEDICINE' }
): Promise<ReminderResponse> => {
  if (!API_BEARER_TOKEN) {
    console.warn('[ReminderService] Missing VITE_API_BEARER_TOKEN');
  }

  // Normalizar prioridad a entero para cumplir con ReminderIn (int | None)
  const PRIORITY_MAP: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };
  let priority: number | null = null;
  if (typeof contextData.priority === 'number') {
    priority = contextData.priority;
  } else if (typeof contextData.priority === 'string') {
    priority = PRIORITY_MAP[contextData.priority] ?? null;
  }

  try {
    const body = {
        text,
        task_id: contextData.taskId || crypto.randomUUID(),
        due_date: null as string | null,
        priority,               // int | null
        type: contextData.type, // 'TODO' | 'MEDICINE'
    };

    const res = await fetch(`${API_URL}/reminder`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `${API_BEARER_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Error ${res.status}: ${errorText}`);
    }

    const data = await res.json();
    
    return { 
        success: true, 
        message: "Reminder sent successfully to AI Endpoint",
        data: data,
        // extra helper para consumir directamente el texto en App
        reminderText: data?.reminder_text
    };

  } catch (err: any) {
    console.error("Error sending reminder:", err);
    
    // Fallback message
    return { 
        success: false, 
        message: `Failed to send: ${err.message || "Unknown error"}` 
    };
  }
};
