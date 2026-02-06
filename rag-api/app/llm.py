"""
LLM utilities for generating responses.
"""
import os
import requests


OLLAMA_HOST = os.getenv('OLLAMA_HOST', 'ollama')
OLLAMA_PORT = os.getenv('OLLAMA_PORT', '11434')
OLLAMA_GENERATION_MODEL = os.getenv('OLLAMA_GENERATION_MODEL', 'llama3.2')


def generate_response(question: str, context: str, temperature: float = 0.7) -> str:
    """
    Generate a response using Ollama LLM.
    
    Args:
        question: User's question
        context: Retrieved context from documents
        temperature: Temperature for generation
        
    Returns:
        Generated response text
    """
    # Construct prompt
    prompt = f"""Eres un asistente experto en legislación española del BOE (Boletín Oficial del Estado).
Tu tarea es responder preguntas sobre legislación basándote únicamente en el contexto proporcionado.

Contexto relevante:
{context}

Pregunta: {question}

Respuesta: Basándome en la legislación del BOE proporcionada, """
    
    url = f"http://{OLLAMA_HOST}:{OLLAMA_PORT}/api/generate"
    payload = {
        "model": OLLAMA_GENERATION_MODEL,
        "prompt": prompt,
        "temperature": temperature,
        "stream": False
    }
    
    try:
        response = requests.post(url, json=payload, timeout=120)
        response.raise_for_status()
        
        result = response.json()
        return result['response']
    except Exception as e:
        return f"Error al generar respuesta: {str(e)}"
