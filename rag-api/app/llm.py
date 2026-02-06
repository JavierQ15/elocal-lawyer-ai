"""
LLM utilities for generating responses.
"""
import os
import requests


OLLAMA_HOST = os.getenv('OLLAMA_HOST', 'ollama')
OLLAMA_PORT = os.getenv('OLLAMA_PORT', '11434')
OLLAMA_GENERATION_MODEL = os.getenv('OLLAMA_GENERATION_MODEL', 'llama3.2')


def generate_response(
    question: str, 
    context: str, 
    temperature: float = 0.7,
    system_prompt: str = None
) -> str:
    """
    Generate a response using Ollama LLM.
    
    Args:
        question: User's question
        context: Retrieved context from documents
        temperature: Temperature for generation
        system_prompt: Optional system prompt to override default
        
    Returns:
        Generated response text
    """
    # Use custom system prompt or default
    if not system_prompt:
        system_prompt = """Eres un asistente experto en legislación española del BOE (Boletín Oficial del Estado).
Tu tarea es responder preguntas sobre legislación basándote únicamente en el contexto proporcionado.
Si la información no está en el contexto, responde: "No consta en el contexto proporcionado."
Cita siempre las fuentes específicas (norma, artículo, fecha de vigencia) al responder."""
    
    # Construct prompt
    prompt = f"""{system_prompt}

Contexto relevante:
{context}

Pregunta: {question}

Respuesta: """
    
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
