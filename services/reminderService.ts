
// Safely access environment variables to prevent crashes if import.meta.env is undefined

// Updated to the specific API URL provided
const API_URL = (import.meta as any)?.env?.VITE_API_URL || 'https://fast-api-v.onrender.com';
// Updated to the specific Bearer Token provided
const API_BEARER_TOKEN = (import.meta as any)?.env?.VITE_API_BEARER_TOKEN || 's3cr3t-Xjd94jf2kLl';

interface ReminderResponse {
  success: boolean;
  message: string;
  data?: any;
}

export const sendReminder = async (
  text: string, 
  contextData: { taskId?: string; priority?: any; type: 'TODO' | 'MEDICINE' }
): Promise<ReminderResponse> => {
  // CAMBIO 1: Loguear la URL correcta
  console.log(`[ReminderService] Sending to ${API_URL}/reminder: "${text}"`, contextData);

  try {
    // CAMBIO 2: Usar la estructura exacta que espera ReminderIn en main.py
    const body = {
        text: text,
        task_id: contextData.taskId || crypto.randomUUID(),
        due_date: null,
        priority: contextData.priority || 2,
        type: contextData.type
    };

    // CAMBIO 3: Apuntar al endpoint correcto /reminder
    const res = await fetch(`${API_URL}/reminder`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_BEARER_TOKEN}`,
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
        data: data
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
