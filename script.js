/****************************************************************************
 *                  AI Keys & Model Configurations
 ***************************************************************************/

const dashscopeApiKey = 'sk-670660d53a6e45cab874bd0bb723a204';
const deepseekApiKey  = 'sk-06b3e9d6d5584df697cb9d9e23560337';
const roboflowApiKey = "oTQiE9ubvwYYk3l3mJvd";
const roboflowModels = [
  "tbc-detection/1",
  "tbx11k-uyoj4/1",
  "tb-detection-lyetd/1",
  "muc1/1",
  "hmis/1",
  "chest-xray-yolo/2",
  "chest-xray-yolo/3",
  "chest-xray-yolo/4",
  "chest-xray-yolo/5",
  "lung-lzjkc/1",
  "tb-2-augmentations/1",
  "vinbigdata-wbf-coco-v2/1",
  "cxr-lesion-detection_test2/1",
  "lungdeseasepreduction/1",
  "capstone-project-2/1"
];

const dashscopeUrl = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';
const deepseekUrl = 'https://api.deepseek.com/chat/completions';

/****************************************************************************
 *                  DOM References & Initial Setup
 ***************************************************************************/

const chatContainer = document.getElementById('chatContainer');
const messageInput  = document.getElementById('messageInput');
const imageInput    = document.getElementById('imageInput');
const sendButton    = document.getElementById('sendButton');
let messages = JSON.parse(localStorage.getItem('chatHistory')) || [];
renderMessages();

/****************************************************************************
 *                  Utility Functions
 ***************************************************************************/

function renderMessages() {
  chatContainer.innerHTML = '';
  messages.forEach(msg => {
    appendMessage(msg.role, msg.content, msg.imageUrl);
  });
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function appendMessage(role, content, imageUrl = null) {
  const messageDiv = document.createElement('div');
  messageDiv.classList.add('message', role);
  
  const textPara = document.createElement('p');
  textPara.textContent = content;
  messageDiv.appendChild(textPara);

  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    messageDiv.appendChild(img);
  }
  chatContainer.appendChild(messageDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

async function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = e => reject(e);
    reader.readAsDataURL(file);
  });
}

/****************************************************************************
 *          AI Pipeline: Roboflow -> (Independent Dashscope) -> DeepSeek
 ***************************************************************************/

/**
 * Sends the image to all Roboflow models concurrently and waits for all responses.
 * @param {string} imageBase64 - Base64 encoded image string.
 * @return {Array} Array of responses from each Roboflow model.
 */
async function inferRoboflow(imageBase64) {
  const promises = roboflowModels.map(model => {
    const url = `https://detect.roboflow.com/${model}?api_key=${roboflowApiKey}`;
    return fetch(url, {
      method: 'POST',
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: imageBase64
    })
      .then(response => response.json())
      .then(data => {
        console.log(`Roboflow model ${model} responded:`, data);
        return { model, data };
      })
      .catch(error => {
        console.error(`Roboflow model ${model} error:`, error);
        return { model, error: error.message };
      });
  });
  return Promise.all(promises);
}

/**
 * Sends the X-ray (and optional user text) to Dashscope for independent analysis,
 * excluding any Roboflow results.
 */
async function sendToDashscopeIndependent(userText, imageBase64) {
  const dashscopeData = {
    model: "qwen-vl-max",
    messages: [
      { 
        role: "user", 
        content: [
          { type: "text", text: `You are an advanced radiology AI. 
            Provide **highly detailed** visual descriptions of this X-ray using:
            
            - **Color variations** (e.g., lighter vs. darker areas)
            - **Brightness levels** (e.g., high-opacity regions)
            - **Texture details** (e.g., nodular, grainy, smooth, reticulated)
            - **Contrast & Borders** (e.g., sharp vs. diffused edges)
            - **Symmetry & Proportions** (e.g., left lung vs. right lung comparisons)

            **Analyze these key areas:**
            1️⃣ **Lung Fields** – Identify opacity, air trapping, or lesions.
            2️⃣ **Cardiac Silhouette** – Assess heart size and contour.
            3️⃣ **Mediastinum** – Examine width and abnormal shadows.
            4️⃣ **Pleura** – Detect effusions, thickening, or pneumothorax.
            5️⃣ **Bones** – Check for fractures, alignment issues.

            Ensure that even a **non-visual AI** can understand your description!`
          },
          ...(userText ? [{ type: "text", text: userText }] : []),
          ...(imageBase64 ? [{ type: "image_url", image_url: { url: imageBase64 } }] : [])
        ]
      }
    ]
  };
  console.log("Sending independent X-ray analysis to Dashscope with data:", dashscopeData);
  
  const response = await fetch(dashscopeUrl, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + dashscopeApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(dashscopeData)
  });
  const result = await response.json();
  console.log("Independent Dashscope response:", result);
  return result;
}

/**
 * Sends a combined prompt (Roboflow results + independent Dashscope analysis)
 * to DeepSeek for final compilation/inference.
 */
async function sendToDeepSeek(combinedText) {
  const deepseekData = {
    model: "deepseek-reasoner",
    messages: [
      { role: "system", content: "Help doctors infer a medical diagnosis based on the combined AI analyses." },
      { role: "user", content: combinedText }
    ]
  };

  console.log("Sending to DeepSeek with data:", deepseekData);
  
  const response = await fetch(deepseekUrl, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + deepseekApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(deepseekData)
  });
  const result = await response.json();
  console.log("DeepSeek response:", result);
  return result;
}

/****************************************************************************
 *                  Main Chat Function
 ***************************************************************************/

async function sendChatMessage() {
  const userText = messageInput.value.trim();
  messageInput.value = '';
  let imageDataUrl = null;

  if (imageInput.files[0]) {
    try {
      imageDataUrl = await readImageFile(imageInput.files[0]);
      imageInput.value = '';
    } catch (error) {
      console.error('Error reading image file:', error);
    }
  }

  // Store and display user's message.
  messages.push({ role: 'user', content: userText, imageUrl: imageDataUrl });
  appendMessage('user', userText, imageDataUrl);

  // Step 1: Send X-ray to Roboflow.
  let roboflowResults = imageDataUrl ? await inferRoboflow(imageDataUrl) : [];
  console.log("Collected Roboflow results:", roboflowResults);
  
  // Step 2: Send the X-ray (and optional user text) independently to Dashscope.
  const dashscopeResultIndependent = await sendToDashscopeIndependent(userText, imageDataUrl);
  const dashscopeReplyIndependent = dashscopeResultIndependent?.choices?.[0]?.message?.content || JSON.stringify(dashscopeResultIndependent);
  
  // Step 3: Combine the Roboflow results and the independent Dashscope analysis.
  const combinedText = `Roboflow AI Predictions:\n${roboflowResults.length ? JSON.stringify(roboflowResults, null, 2) : "No Roboflow results."}\n\nIndependent Dashscope Analysis:\n${dashscopeReplyIndependent}`;
  
  // Step 4: Send the combined text to DeepSeek.
  const deepseekResult = await sendToDeepSeek(combinedText);
  const finalMessage = deepseekResult?.choices?.[0]?.message?.content || JSON.stringify(deepseekResult);
  
  messages.push({ role: 'bot', content: finalMessage });
  appendMessage('bot', finalMessage);

  localStorage.setItem('chatHistory', JSON.stringify(messages));
}

/****************************************************************************
 *                  Event Listeners
 ***************************************************************************/

sendButton.addEventListener('click', sendChatMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendChatMessage();
  }
});
