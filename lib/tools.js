const axios = require('axios').default;

/**
 * Tests whether the given variable is a real object and not an Array
 *
 * @param it The variable to test
 * @returns true if 'it' was an object
 */
function isObject(it) {
    // This is necessary because:
    // typeof null === 'object'
    // typeof [] === 'object'
    // [] instanceof Object === true
    return Object.prototype.toString.call(it) === '[object Object]';
}

/**
 * Tests whether the given variable is really an Array
 *
 * @param it The variable to test
 * @returns true if 'it' is an array
 */
function isArray(it) {
    if (typeof Array.isArray === 'function') {
        return Array.isArray(it);
    }
    return Object.prototype.toString.call(it) === '[object Array]';
}

/**
 * Translates text to the target language. Automatically chooses the right translation API.
 *
 * @param text The text to translate
 * @param targetLang The target languate
 * @param [yandexApiKey] The yandex API key. You can create one for free at https://translate.yandex.com/developers
 * @returns translated text
 */
async function translateText(text, targetLang, yandexApiKey) {
    if (targetLang === 'en') {
        return text;
    } else if (!text) {
        return '';
    }
    if (yandexApiKey) {
        return translateYandex(text, targetLang, yandexApiKey);
    }
    return translateGoogle(text, targetLang);
}

/**
 * Translates text with Yandex API
 *
 * @param text The text to translate
 * @param targetLang The target languate
 * @param apiKey The yandex API key. You can create one for free at https://translate.yandex.com/developers
 * @returns translated text
 */
async function translateYandex(text, targetLang, apiKey) {
    if (targetLang === 'zh-cn') {
        targetLang = 'zh';
    }
    try {
        const url = `https://translate.yandex.net/api/v1.5/tr.json/translate?key=${apiKey}&text=${encodeURIComponent(text)}&lang=en-${targetLang}`;
        const response = await axios({ url, timeout: 15000 });
        if (response.data && response.data.text && isArray(response.data.text)) {
            return response.data.text[0];
        }
        throw new Error('Invalid response for translate request');
    } catch (e) {
        throw new Error(`Could not translate to "${targetLang}": ${e}`);
    }
}

/**
 * Translates text with Google API
 *
 * @param text The text to translate
 * @param targetLang The target languate
 * @returns translated text
 */
async function translateGoogle(text, targetLang) {
    try {
        const url = `http://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}&ie=UTF-8&oe=UTF-8`;
        const response = await axios({ url, timeout: 15000 });
        if (isArray(response.data)) {
            // we got a valid response
            return response.data[0][0][0];
        }
        throw new Error('Invalid response for translate request');
    } catch (e) {
        if (e.response && e.response.status === 429) {
            throw new Error(`Could not translate to "${targetLang}": Rate-limited by Google Translate`);
        } else {
            throw new Error(`Could not translate to "${targetLang}": ${e}`);
        }
    }
}

module.exports = {
    isArray,
    isObject,
    translateText,
};
