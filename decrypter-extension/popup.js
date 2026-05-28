document.addEventListener("DOMContentLoaded", () => {
  const keyInput = document.getElementById("enc-key");
  const saveBtn = document.getElementById("save-btn");
  const statusMsg = document.getElementById("status-msg");

  // Load existing key, default to staging key
  const defaultStgKey = 'd427e682c1a848a6a5e5f0178759b137';
  chrome.storage.local.get(["encryption_key"], (result) => {
    if (result.encryption_key) {
      keyInput.value = result.encryption_key;
    } else {
      keyInput.value = defaultStgKey;
      chrome.storage.local.set({ encryption_key: defaultStgKey });
    }
  });

  saveBtn.addEventListener("click", () => {
    const rawKey = keyInput.value.trim();

    chrome.storage.local.set({ encryption_key: rawKey }, () => {
      statusMsg.textContent = "Key saved successfully!";
      setTimeout(() => {
        statusMsg.textContent = "";
      }, 2000);
    });
  });
});
