
import { GoogleGenAI } from "@google/genai";

export const performOCR = async (base64Image: string, mimeType: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: mimeType,
            },
          },
          {
            text: "Extract all text from this document image exactly as it appears. Provide only the extracted text, no commentary.",
          },
        ],
      },
      config: {
        thinkingConfig: { thinkingBudget: 0 } // Speed is priority
      }
    });

    return response.text || "";
  } catch (error) {
    console.error("Gemini OCR Error:", error);
    throw error;
  }
};
