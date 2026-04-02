package com.example.dipprog.util

import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Сеть на IO, результат на главном потоке; отмена при уничтожении Activity. */
inline fun <T> AppCompatActivity.launchIo(
    crossinline work: () -> T,
    crossinline onMain: (T) -> Unit,
) {
    lifecycleScope.launch(Dispatchers.IO) {
        val result = work()
        withContext(Dispatchers.Main) { onMain(result) }
    }
}
