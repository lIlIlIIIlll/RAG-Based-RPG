# Guia de Uso - CLI Proxy API

Este guia ensina a usar a CLI Proxy API para acessar modelos de IA (Claude, Gemini, etc.) via Antigravity.

## Configuração Base

| Configuração | Valor                                            |
| ------------ | ------------------------------------------------ |
| **Base URL** | `http://localhost:8317/v1`                       |
| **API Key**  | `your-api-key-1` (ou configure em `config.yaml`) |
| **Endpoint** | `/v1/chat/completions`                           |

---

## Modelos Disponíveis

| Modelo                       | ID para API                         |
| ---------------------------- | ----------------------------------- |
| Claude Opus 4.5 (thinking)   | `gemini-claude-opus-4-5-thinking`   |
| Claude Opus 4.6 (thinking)   | `gemini-claude-opus-4-6-thinking`   |
| Claude Sonnet 4.5            | `gemini-claude-sonnet-4-5`          |
| Claude Sonnet 4.5 (thinking) | `gemini-claude-sonnet-4-5-thinking` |
| Gemini 3 Pro                 | `gemini-3-pro-preview`              |
| Gemini 3 Flash               | `gemini-3-flash-preview`            |
| Gemini 3 Pro Image           | `gemini-3-pro-image-preview`        |
| Gemini 2.5 Flash             | `gemini-2.5-flash`                  |
| Gemini 2.5 Flash Lite        | `gemini-2.5-flash-lite`             |
| GPT-OSS 120B                 | `gpt-oss-120b-medium`               |

> **Dica:** Liste modelos disponíveis com `GET /v1/models`

---

## Exemplos de Uso

### Python (SDK OpenAI)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8317/v1",
    api_key="your-api-key-1"
)

# Chat simples
response = client.chat.completions.create(
    model="gemini-claude-opus-4-5-thinking",
    messages=[
        {"role": "user", "content": "Olá, como você está?"}
    ]
)
print(response.choices[0].message.content)
```

### Python com Streaming

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8317/v1",
    api_key="your-api-key-1"
)

stream = client.chat.completions.create(
    model="gemini-3-pro-preview",
    messages=[{"role": "user", "content": "Conte uma história curta."}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

### JavaScript/Node.js

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8317/v1",
  apiKey: "your-api-key-1",
});

const response = await client.chat.completions.create({
  model: "gemini-claude-opus-4-5-thinking",
  messages: [{ role: "user", content: "Olá, como você está?" }],
});

console.log(response.choices[0].message.content);
```

### cURL

```bash
curl http://localhost:8317/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key-1" \
  -d '{
    "model": "gemini-claude-opus-4-5-thinking",
    "messages": [{"role": "user", "content": "Olá!"}]
  }'
```

### PowerShell

```powershell
$body = @{
    model = "gemini-claude-opus-4-5-thinking"
    messages = @(
        @{ role = "user"; content = "Olá!" }
    )
} | ConvertTo-Json -Depth 3

Invoke-RestMethod -Uri "http://localhost:8317/v1/chat/completions" `
    -Method Post `
    -ContentType "application/json" `
    -Headers @{ Authorization = "Bearer your-api-key-1" } `
    -Body $body
```

---

## Conversas com Contexto

O modelo mantém contexto através do array `messages`:

```python
messages = [
    {"role": "system", "content": "Você é um assistente prestativo."},
    {"role": "user", "content": "Meu nome é João."},
    {"role": "assistant", "content": "Olá João! Como posso ajudar?"},
    {"role": "user", "content": "Qual é meu nome?"}
]

response = client.chat.completions.create(
    model="gemini-3-pro-preview",
    messages=messages
)
# Resposta: "Seu nome é João."
```

---

## Parâmetros Opcionais

| Parâmetro     | Tipo        | Descrição                                            |
| ------------- | ----------- | ---------------------------------------------------- |
| `temperature` | float (0-2) | Criatividade. 0 = determinístico, 2 = muito criativo |
| `max_tokens`  | int         | Limite de tokens na resposta                         |
| `stream`      | bool        | Streaming de resposta token por token                |
| `top_p`       | float (0-1) | Nucleus sampling                                     |

```python
response = client.chat.completions.create(
    model="gemini-3-pro-preview",
    messages=[{"role": "user", "content": "Escreva um poema."}],
    temperature=0.8,
    max_tokens=500
)
```

---

## System Instructions

Use a role `system` para definir o comportamento, personalidade e regras do assistente:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8317/v1",
    api_key="your-api-key-1"
)

response = client.chat.completions.create(
    model="gemini-claude-opus-4-5-thinking",
    messages=[
        {
            "role": "system",
            "content": """Você é um especialista em Python.

Regras:
- Responda sempre em português brasileiro
- Use exemplos de código quando apropriado
- Seja conciso e direto
- Formate código com syntax highlighting"""
        },
        {"role": "user", "content": "Como faço uma list comprehension?"}
    ]
)
print(response.choices[0].message.content)
```

### Exemplos de System Instructions

```python
# Assistente de código
system_dev = "Você é um desenvolvedor sênior. Sempre explique o raciocínio antes de dar código."

# Tradutor
system_tradutor = "Você é um tradutor profissional. Traduza textos mantendo o tom original."

# Assistente criativo
system_criativo = "Você é um escritor criativo. Use linguagem rica e metáforas."

# Assistente técnico
system_tecnico = "Você é um engenheiro de software. Seja preciso e cite fontes quando possível."
```

---

## Function Calling (Tools)

Permita que o modelo chame funções definidas por você:

### Definindo Funções

```python
from openai import OpenAI
import json

client = OpenAI(
    base_url="http://localhost:8317/v1",
    api_key="your-api-key-1"
)

# Definir as ferramentas disponíveis
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Obtém a temperatura atual de uma cidade",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "Nome da cidade, ex: São Paulo"
                    },
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "description": "Unidade de temperatura"
                    }
                },
                "required": ["city"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_database",
            "description": "Busca informações no banco de dados",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Termo de busca"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Número máximo de resultados"
                    }
                },
                "required": ["query"]
            }
        }
    }
]

response = client.chat.completions.create(
    model="gemini-3-pro-preview",
    messages=[{"role": "user", "content": "Qual a temperatura em Tokyo?"}],
    tools=tools,
    tool_choice="auto"  # "auto", "none", ou {"type": "function", "function": {"name": "..."}}
)

print(response.choices[0].message)
```

### Processando Tool Calls

```python
def get_weather(city: str, unit: str = "celsius") -> dict:
    # Sua lógica real aqui (API de clima, etc.)
    return {"city": city, "temperature": 22, "unit": unit}

def search_database(query: str, limit: int = 10) -> list:
    # Sua lógica real aqui
    return [{"id": 1, "result": f"Resultado para: {query}"}]

# Mapear nomes para funções
available_functions = {
    "get_weather": get_weather,
    "search_database": search_database
}

# Processar resposta do modelo
message = response.choices[0].message

if message.tool_calls:
    # O modelo quer chamar uma função
    for tool_call in message.tool_calls:
        function_name = tool_call.function.name
        function_args = json.loads(tool_call.function.arguments)

        # Executar a função
        function_response = available_functions[function_name](**function_args)

        # Enviar resultado de volta ao modelo
        messages = [
            {"role": "user", "content": "Qual a temperatura em Tokyo?"},
            message,  # Resposta do assistente com tool_call
            {
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(function_response)
            }
        ]

        # Segunda chamada com o resultado
        final_response = client.chat.completions.create(
            model="gemini-3-pro-preview",
            messages=messages,
            tools=tools
        )

        print(final_response.choices[0].message.content)
```

### Exemplo Completo: Agente com Múltiplas Tools

```python
from openai import OpenAI
import json

client = OpenAI(
    base_url="http://localhost:8317/v1",
    api_key="your-api-key-1"
)

# Funções reais
def calculator(operation: str, a: float, b: float) -> float:
    ops = {
        "add": a + b,
        "subtract": a - b,
        "multiply": a * b,
        "divide": a / b if b != 0 else "Erro: divisão por zero"
    }
    return ops.get(operation, "Operação inválida")

def get_current_time(timezone: str = "America/Sao_Paulo") -> str:
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

# Definição das tools
tools = [
    {
        "type": "function",
        "function": {
            "name": "calculator",
            "description": "Realiza operações matemáticas básicas",
            "parameters": {
                "type": "object",
                "properties": {
                    "operation": {
                        "type": "string",
                        "enum": ["add", "subtract", "multiply", "divide"]
                    },
                    "a": {"type": "number"},
                    "b": {"type": "number"}
                },
                "required": ["operation", "a", "b"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "Retorna a hora atual",
            "parameters": {
                "type": "object",
                "properties": {
                    "timezone": {"type": "string"}
                }
            }
        }
    }
]

functions = {"calculator": calculator, "get_current_time": get_current_time}

def run_agent(user_message: str):
    messages = [{"role": "user", "content": user_message}]

    response = client.chat.completions.create(
        model="gemini-3-pro-preview",
        messages=messages,
        tools=tools
    )

    msg = response.choices[0].message

    # Loop enquanto houver tool calls
    while msg.tool_calls:
        messages.append(msg)

        for tc in msg.tool_calls:
            result = functions[tc.function.name](**json.loads(tc.function.arguments))
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": json.dumps(result)
            })

        response = client.chat.completions.create(
            model="gemini-3-pro-preview",
            messages=messages,
            tools=tools
        )
        msg = response.choices[0].message

    return msg.content

# Usar o agente
print(run_agent("Quanto é 145 * 32?"))
print(run_agent("Que horas são agora?"))
```

---

## Listar Modelos Disponíveis

```python
models = client.models.list()
for model in models.data:
    print(model.id)
```

---

## Erros Comuns

| Erro                         | Causa                     | Solução                           |
| ---------------------------- | ------------------------- | --------------------------------- |
| `unknown provider for model` | Modelo não existe         | Use um modelo da lista disponível |
| `Connection refused`         | Servidor não está rodando | Execute `.\cli-proxy-api.exe`     |
| `401 Unauthorized`           | API key inválida          | Verifique a key no `config.yaml`  |

---

## Início Rápido

1. **Inicie o servidor:**

   ```powershell
   .\cli-proxy-api.exe
   ```

2. **Instale o SDK (Python):**

   ```bash
   pip install openai
   ```

3. **Use a API:**

   ```python
   from openai import OpenAI

   client = OpenAI(
       base_url="http://localhost:8317/v1",
       api_key="your-api-key-1"
   )

   r = client.chat.completions.create(
       model="gemini-claude-opus-4-5-thinking",
       messages=[{"role": "user", "content": "Olá!"}]
   )
   print(r.choices[0].message.content)
   ```

---

**Documentação oficial:** https://help.router-for.me/
