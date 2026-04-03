package com.example.dipprog

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import android.os.Bundle
import android.util.Log
import android.view.HapticFeedbackConstants
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MenuItem
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import com.example.dipprog.R
import com.example.dipprog.api.BuildsAdapter
import com.example.dipprog.api.BuildsApi
import com.example.dipprog.api.BuildComponentsAdapter
import com.example.dipprog.api.CartAdapter
import com.example.dipprog.api.ComponentsAdapter
import com.example.dipprog.api.OrdersAdapter
import com.example.dipprog.api.priceStr
import com.example.dipprog.auth.AuthApi
import com.example.dipprog.auth.SessionManager
import com.example.dipprog.guide.BeginnerGuide
import com.example.dipprog.guide.GuideAdapter
import com.example.dipprog.util.ComponentSpecFormatter
import com.example.dipprog.util.launchIo
import android.widget.ArrayAdapter
import android.widget.Spinner
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.badge.BadgeDrawable
import com.google.android.material.color.MaterialColors
import com.google.android.material.snackbar.Snackbar
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.google.android.material.button.MaterialButton
import com.google.android.material.button.MaterialButtonToggleGroup
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.materialswitch.MaterialSwitch
import com.google.android.material.tabs.TabLayout
import com.google.android.material.textfield.TextInputEditText
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.graphics.Typeface
import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.text.TextUtils
import android.text.Editable
import android.text.TextWatcher
import android.view.inputmethod.EditorInfo
import android.widget.ImageButton
import android.widget.ImageView
import coil.load
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

class MainActivity : AppCompatActivity() {

    private lateinit var homePage: View
    private lateinit var settingsPage: View
    private lateinit var buildPage: View
    private lateinit var aiChatPage: View
    private lateinit var ordersPage: View
    private lateinit var profilePage: View
    private lateinit var guidePage: View
    private lateinit var bottomNavigationView: BottomNavigationView
    private lateinit var authOverlay: FrameLayout
    private lateinit var topAppBar: MaterialToolbar
    private lateinit var sessionManager: SessionManager

    private val authBackCallback = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
            if (sessionManager.isGuestMode) {
                hideAuthOverlay()
            } else {
                finish()
            }
        }
    }
    private var loadCartCallback: (() -> Unit)? = null
    private var refreshOrdersCallback: (() -> Unit)? = null
    private var lastOrderNotificationId: Int = -1
    private var lastOrderNotificationCheckAt: Long = 0L

    // --- Добавленные поля для настроек ---
    private lateinit var themeToggleGroup: MaterialButtonToggleGroup
    private lateinit var notificationsSwitch: MaterialSwitch
    private lateinit var sharedPreferences: SharedPreferences
    private val PREFS_NAME = "MyPrefs"
    private val THEME_KEY = "selected_theme"
    private val NOTIFICATIONS_KEY = "notifications_enabled"

    // --- Добавленные поля для чата ---
    private lateinit var messagesContainer: LinearLayout
    private lateinit var messageInputEditText: TextInputEditText
    private lateinit var sendMessageButton: MaterialButton
    private lateinit var attachBuildButton: MaterialButton
    private lateinit var messagesScrollView: ScrollView
    /** История текстовых сообщений чата (без карточек подборок) — для восстановления после смены темы */
    private val chatHistory = mutableListOf<Pair<String, Boolean>>()
    /** Последние карточки подборок ИИ — для восстановления после смены темы */
    private var lastSuggestions: List<BuildsApi.BuildSuggestion> = emptyList()
    /** История для ИИ-контекста (последние 8 обменов) */
    private val apiChatHistory = mutableListOf<BuildsApi.ChatHistoryMessage>()
    /** Handler для анимации "печатает…" */
    private val typingHandler = Handler(Looper.getMainLooper())
    private var typingRunnable: Runnable? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Загрузка темы ДО setContentView
        loadSettings()

        setContentView(R.layout.activity_main)

        topAppBar = findViewById(R.id.topAppBar)
        authOverlay = findViewById(R.id.authOverlay)
        sessionManager = SessionManager(this)
        onBackPressedDispatcher.addCallback(this, authBackCallback)

        // Инициализация views
        homePage = findViewById(R.id.homePage)
        settingsPage = findViewById(R.id.settingsPage)
        buildPage = findViewById(R.id.buildPage)
        aiChatPage = findViewById(R.id.aiChatPage)
        ordersPage = findViewById(R.id.ordersPage)
        profilePage = findViewById(R.id.profilePage)
        guidePage = findViewById(R.id.guidePage)
        bottomNavigationView = findViewById(R.id.bottomNavigationView)

        // Сразу скрываем все страницы, чтобы не было «мерцания» и лишних обращений к неготовым view
        homePage.visibility = View.GONE
        settingsPage.visibility = View.GONE
        buildPage.visibility = View.GONE
        aiChatPage.visibility = View.GONE
        ordersPage.visibility = View.GONE
        profilePage.visibility = View.GONE
        guidePage.visibility = View.GONE

        // --- Инициализация views для настроек ---
        themeToggleGroup = settingsPage.findViewById(R.id.themeToggleGroup)
        notificationsSwitch = settingsPage.findViewById(R.id.notificationsSwitch)
        // TextView для версии можно найти и установить значение при необходимости
        val versionInfoText: android.widget.TextView = settingsPage.findViewById(R.id.versionInfoText)
        try {
            val pInfo = packageManager.getPackageInfo(packageName, 0)
            val versionName = pInfo.versionName
            versionInfoText.text = "Версия: $versionName"
        } catch (e: Exception) {
            Log.e("Settings", "Error getting version info", e)
            versionInfoText.text = "Версия: Неизвестна"
        }


        sharedPreferences = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        // --- Инициализация views для чата ---
        messagesContainer = aiChatPage.findViewById(R.id.messagesContainer)
        messageInputEditText = aiChatPage.findViewById(R.id.messageInputEditText)
        sendMessageButton = aiChatPage.findViewById(R.id.sendMessageButton)
        attachBuildButton = aiChatPage.findViewById(R.id.attachBuildButton)
        messagesScrollView = aiChatPage.findViewById(R.id.messagesScrollView)


        setupBottomNavigation()
        setupBuildPageTabs()
        setupBuildsAndCart()
        setupOrdersPage()
        setupHomePage()
        setupGuidePage()
        setupTopBarMenu()
        setupProfileListeners()
        setupSettingsListeners()
        setupChatListeners()
        setupAuthScreen()
        restoreChatFromState(savedInstanceState)
        updateProfileUI()
        syncSessionFromServerIfNeeded()
        updateOrdersTabVisibility()

        // Показываем нужную страницу после завершения раскладки (избегаем падения при обращении к BottomNavigationView)
        val savedId = if (savedInstanceState != null && savedInstanceState.containsKey(KEY_CURRENT_PAGE)) {
            savedInstanceState.getInt(KEY_CURRENT_PAGE)
        } else {
            R.id.navigation_home
        }
        val initialPage = if (!sessionManager.isLoggedIn && savedId == R.id.navigation_orders) {
            R.id.navigation_home
        } else {
            savedId
        }
        homePage.post { showPageById(initialPage) }
    }

    private fun syncSessionFromServerIfNeeded() {
        val tok = sessionManager.token ?: return
        launchIo(
            work = { AuthApi.me(tok) },
            onMain = { r ->
                when (r) {
                    is AuthApi.ApiResult.Success -> {
                        val prevRole = sessionManager.userRole
                        sessionManager.userName = r.data.user.name
                        sessionManager.userEmail = r.data.user.email
                        sessionManager.userAvatarUrl = r.data.user.avatar_url
                        sessionManager.userRole = r.data.user.role ?: "customer"
                        updateOrdersTabVisibility()
                        updateProfileUI()
                        // Если роль изменилась (например, стал сборщиком) — перезагрузить заказы
                        if (prevRole != sessionManager.userRole) {
                            refreshOrdersCallback?.invoke()
                        }
                    }
                    else -> {}
                }
            },
        )
    }

    private fun getPageViewForId(id: Int): View = when (id) {
        R.id.navigation_home -> homePage
        R.id.navigation_build -> buildPage
        R.id.navigation_ai_chat -> aiChatPage
        R.id.navigation_orders -> ordersPage
        R.id.action_profile -> profilePage
        R.id.action_settings -> settingsPage
        R.id.action_guide -> guidePage
        else -> homePage
    }

    private fun showPageById(id: Int) {
        currentPageId = id
        val page = getPageViewForId(id)
        showPage(page)
        when (id) {
            R.id.navigation_home -> {
                bottomNavigationView.selectedItemId = R.id.navigation_home
                refreshHomeBuildsCard?.invoke()
            }
            R.id.navigation_build -> {
                bottomNavigationView.selectedItemId = R.id.navigation_build
                refreshBuildList?.invoke()
            }
            R.id.navigation_ai_chat -> {
                bottomNavigationView.selectedItemId = R.id.navigation_ai_chat
                scrollToBottomOfMessages()
            }
            R.id.navigation_orders -> {
                bottomNavigationView.selectedItemId = R.id.navigation_orders
                Thread {
                    BuildsApi.markOrderNotificationsRead(sessionManager.token)
                    runOnUiThread {
                        clearOrdersTabBadge()
                        refreshOrdersCallback?.invoke()
                    }
                }.start()
            }
            R.id.action_profile -> updateProfileUI()
            R.id.action_settings -> updateSettingsUI()
            R.id.action_guide -> { }
        }
        if (id != R.id.navigation_orders) {
            maybeCheckOrderNotifications()
        }
        updateToolbarTitleForPage(id)
    }

    private fun updateToolbarTitleForPage(id: Int) {
        val bar = findViewById<MaterialToolbar>(R.id.topAppBar)
        when (id) {
            R.id.action_guide -> bar.setTitle(R.string.menu_guide)
            R.id.action_profile -> bar.setTitle(R.string.menu_profile)
            R.id.navigation_orders -> bar.setTitle(R.string.menu_orders)
            else -> bar.setTitle(R.string.app_toolbar_title)
        }
    }

    private var currentBuildId: Int? = null
    private var refreshBuildList: (() -> Unit)? = null
    private var lastBuildDetail: BuildsApi.BuildDetail? = null
    private var refreshHomeBuildsCard: (() -> Unit)? = null
    /** Запрос с главной — подставляется в поиск каталога при открытии «Сборка». */
    private var pendingPickerSearchQuery: String? = null
    private var currentPageId: Int = R.id.navigation_home
    private var openBuildPageWithCategory: ((String?) -> Unit)? = null
    private var createPresetBuildAndOpen: ((String, String) -> Unit)? = null
    private companion object {
        const val KEY_CURRENT_PAGE = "currentPageId"
        const val BUNDLE_CHAT_TEXTS = "chat_texts"
        const val BUNDLE_CHAT_IS_USER = "chat_is_user"
        const val BUNDLE_CHAT_SUGGESTIONS = "chat_suggestions"
        const val BUNDLE_API_HISTORY = "api_chat_history"
    }
    private val chatGson = Gson()

    private fun setupBuildsAndCart() {
        val createBtn = buildPage.findViewById<MaterialButton>(R.id.createBuildButton)
        val createBtnHeader = buildPage.findViewById<MaterialButton>(R.id.createBuildButtonHeader)
        createBtnHeader.visibility = View.GONE
        val buildsRecycler = buildPage.findViewById<RecyclerView>(R.id.buildsRecyclerView)
        val buildListEmptyCard = buildPage.findViewById<View>(R.id.buildListEmptyCard)
        val buildListInclude = buildPage.findViewById<View>(R.id.buildListInclude)
        val buildDetailInclude = buildPage.findViewById<View>(R.id.buildDetailInclude)
        val buildDetailBack = buildPage.findViewById<MaterialButton>(R.id.buildDetailBack)
        val buildDetailName = buildPage.findViewById<TextView>(R.id.buildDetailName)
        val buildDetailRecycler = buildPage.findViewById<RecyclerView>(R.id.buildDetailRecycler)
        val buildDetailTotal = buildPage.findViewById<TextView>(R.id.buildDetailTotal)
        val buildDetailCompatibilityCard = buildPage.findViewById<View>(R.id.buildDetailCompatibilityCard)
        val buildDetailCompatibilityContent = buildPage.findViewById<LinearLayout>(R.id.buildDetailCompatibilityContent)
        var currentBuildComponentsList: List<BuildsApi.BuildComponent> = emptyList()
        val buildDetailMissingCard = buildPage.findViewById<View>(R.id.buildDetailMissingCard)
        val buildDetailMissingText = buildPage.findViewById<TextView>(R.id.buildDetailMissingText)
        val buildDetailAddBtn = buildPage.findViewById<MaterialButton>(R.id.buildDetailAddComponents)
        val buildDetailAddBuildToCart = buildPage.findViewById<MaterialButton>(R.id.buildDetailAddBuildToCart)
        val buildDetailShare = buildPage.findViewById<MaterialButton>(R.id.buildDetailShare)
        val buildDetailDuplicate = buildPage.findViewById<MaterialButton>(R.id.buildDetailDuplicate)
        val cartRecycler = buildPage.findViewById<RecyclerView>(R.id.cartRecyclerView)
        val cartEmptyCard = buildPage.findViewById<View>(R.id.cartEmptyCard)
        val cartTotalText = buildPage.findViewById<TextView>(R.id.cartTotalText)
        val checkoutOrderBtn = buildPage.findViewById<MaterialButton>(R.id.checkoutOrderButton)
        val goToShoppingBtn = buildPage.findViewById<MaterialButton>(R.id.goToShoppingButton)
        var currentCartItems: List<BuildsApi.CartItem> = emptyList()

        buildsRecycler.layoutManager = LinearLayoutManager(this)
        buildDetailRecycler.layoutManager = LinearLayoutManager(this)
        cartRecycler.layoutManager = LinearLayoutManager(this)

        var loadBuildDetail: (Int) -> Unit = {}
        var loadCart: () -> Unit = {}
        var loadBuildsList: () -> Unit = {}

        val buildsAdapter = BuildsAdapter(emptyList()) { build ->
            currentBuildId = build.id
            buildListInclude.visibility = View.GONE
            buildDetailInclude.visibility = View.VISIBLE
            loadBuildDetail(build.id)
        }
        val buildComponentsAdapter = BuildComponentsAdapter(
            emptyList(),
            onRemove = { comp ->
                val bid = currentBuildId ?: return@BuildComponentsAdapter
                Thread {
                    val r = BuildsApi.removeFromBuild(sessionManager.token, bid, comp.component_id)
                    runOnUiThread {
                        if (r is BuildsApi.ApiResult.Success) loadBuildDetail(bid)
                        else Snackbar.make(buildPage, (r as BuildsApi.ApiResult.Error).message, Snackbar.LENGTH_SHORT).show()
                    }
                }.start()
            },
            onComponentClick = { comp ->
                Thread {
                    val r = BuildsApi.componentDetail(sessionManager.token, comp.component_id)
                    runOnUiThread {
                        when (r) {
                            is BuildsApi.ApiResult.Success -> showComponentDetailDialog(r.data)
                            is BuildsApi.ApiResult.Error -> Snackbar.make(buildPage, r.message, Snackbar.LENGTH_SHORT).show()
                        }
                    }
                }.start()
            }
        )
        val cartAdapter = CartAdapter(emptyList()) { item ->
            Thread {
                val r = BuildsApi.removeFromCart(sessionManager.token, item.component_id)
                runOnUiThread {
                    if (r is BuildsApi.ApiResult.Success) loadCart()
                    else Snackbar.make(buildPage, (r as BuildsApi.ApiResult.Error).message, Snackbar.LENGTH_SHORT).show()
                }
            }.start()
        }

        buildsRecycler.adapter = buildsAdapter
        buildDetailRecycler.adapter = buildComponentsAdapter
        cartRecycler.adapter = cartAdapter

        loadBuildsList = {
            if (sessionManager.isLoggedIn) {
                Thread {
                    val r = BuildsApi.builds(sessionManager.token)
                    runOnUiThread {
                        when (r) {
                            is BuildsApi.ApiResult.Success -> {
                                val list = r.data
                                if (list.isEmpty()) {
                                    buildListEmptyCard.visibility = View.VISIBLE
                                    buildsRecycler.visibility = View.GONE
                                    createBtnHeader.visibility = View.GONE
                                } else {
                                    buildListEmptyCard.visibility = View.GONE
                                    buildsRecycler.visibility = View.VISIBLE
                                    createBtnHeader.visibility = View.VISIBLE
                                    buildsAdapter.setData(list)
                                }
                            }
                            else -> {
                                buildListEmptyCard.visibility = View.VISIBLE
                                buildsRecycler.visibility = View.GONE
                                createBtnHeader.visibility = View.GONE
                            }
                        }
                    }
                }.start()
            } else {
                buildListEmptyCard.visibility = View.VISIBLE
                buildsRecycler.visibility = View.GONE
                createBtnHeader.visibility = View.GONE
            }
        }

        loadBuildDetail = { buildId ->
            Thread {
                val r = BuildsApi.buildDetail(sessionManager.token, buildId)
                runOnUiThread {
                    when (r) {
                        is BuildsApi.ApiResult.Success -> {
                            val b = r.data
                            lastBuildDetail = b
                            currentBuildComponentsList = b.components ?: emptyList()
                            buildDetailName.text = b.name
                            buildComponentsAdapter.setData(currentBuildComponentsList)
                            buildDetailTotal.text = "Итого: ${priceStr(b.total_price)}"
                            val presentSlugs = (b.components?.mapNotNull { it.category_slug }?.toSet() ?: emptySet())
                            val recommendedSlugs = setOf("processors", "motherboard", "ram", "storage", "psu", "case")
                            val missingSlugs = recommendedSlugs - presentSlugs
                            val slugToName = mapOf(
                                "processors" to "Процессор",
                                "motherboard" to "Материнская плата",
                                "ram" to "ОЗУ",
                                "storage" to "Накопитель",
                                "gpu" to "Видеокарта",
                                "psu" to "Блок питания",
                                "case" to "Корпус"
                            )
                            if (missingSlugs.isNotEmpty()) {
                                buildDetailMissingCard.visibility = View.VISIBLE
                                buildDetailMissingText.text = "Рекомендуется добавить: " + missingSlugs.mapNotNull { slugToName[it] }.joinToString(", ")
                            } else {
                                buildDetailMissingCard.visibility = View.GONE
                            }
                        }
                        is BuildsApi.ApiResult.Error -> Snackbar.make(buildPage, r.message, Snackbar.LENGTH_SHORT).show()
                    }
                }
                val compat = BuildsApi.buildCompatibility(sessionManager.token, buildId)
                runOnUiThread {
                    val list = when (compat) {
                        is BuildsApi.ApiResult.Success -> compat.data.warnings
                        else -> null
                    }
                    if (!list.isNullOrEmpty()) {
                        buildDetailCompatibilityCard.visibility = View.VISIBLE
                        buildDetailCompatibilityContent.removeAllViews()
                        val typeToSlugs: (String?) -> List<String> = { type ->
                            when (type) {
                                "socket" -> listOf("processors", "motherboard")
                                "ram" -> listOf("ram")
                                "psu" -> listOf("psu")
                                else -> emptyList()
                            }
                        }
                        for (w in list) {
                            val msgRow = LinearLayout(this@MainActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                setPadding(0, 4, 0, 12)
                            }
                            val msgTv = TextView(this@MainActivity).apply {
                                text = w.message ?: ""
                                textSize = 13f
                                setTextColor(resources.getColor(android.R.color.black, theme))
                                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                                    breakStrategy = Layout.BREAK_STRATEGY_SIMPLE
                                    hyphenationFrequency = Layout.HYPHENATION_FREQUENCY_NONE
                                }
                            }
                            msgRow.addView(msgTv)
                            val slugs = typeToSlugs(w.type)
                            val related = currentBuildComponentsList.filter { it.category_slug in slugs }
                            if (related.isNotEmpty()) {
                                val btnRow = LinearLayout(this@MainActivity).apply {
                                    orientation = LinearLayout.VERTICAL
                                    setPadding(0, 4, 0, 0)
                                }
                                val gap = (8 * resources.displayMetrics.density).toInt()
                                for (comp in related) {
                                    val removeBtn = MaterialButton(this@MainActivity, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                                        layoutParams = LinearLayout.LayoutParams(
                                            LinearLayout.LayoutParams.MATCH_PARENT,
                                            LinearLayout.LayoutParams.WRAP_CONTENT
                                        ).apply { bottomMargin = gap }
                                        maxLines = 2
                                        ellipsize = TextUtils.TruncateAt.END
                                        text = getString(R.string.build_remove_component, comp.name)
                                        setOnClickListener {
                                            val bid = currentBuildId ?: return@setOnClickListener
                                            Thread {
                                                val res = BuildsApi.removeFromBuild(sessionManager.token, bid, comp.component_id)
                                                runOnUiThread {
                                                    if (res is BuildsApi.ApiResult.Success) loadBuildDetail(bid)
                                                    else Snackbar.make(buildPage, (res as BuildsApi.ApiResult.Error).message, Snackbar.LENGTH_SHORT).show()
                                                }
                                            }.start()
                                        }
                                    }
                                    btnRow.addView(removeBtn)
                                }
                                msgRow.addView(btnRow)
                            }
                            buildDetailCompatibilityContent.addView(msgRow)
                        }
                    } else {
                        buildDetailCompatibilityCard.visibility = View.GONE
                    }
                }
            }.start()
        }

        loadCart = {
            if (!sessionManager.isLoggedIn) {
                cartRecycler.visibility = View.GONE
                cartEmptyCard.visibility = View.VISIBLE
                cartTotalText.visibility = View.GONE
                checkoutOrderBtn.visibility = View.GONE
            } else {
                Thread {
                    val r = BuildsApi.cart(sessionManager.token)
                    runOnUiThread {
                        when (r) {
                            is BuildsApi.ApiResult.Success -> {
                                val items = r.data.items
                                if (items.isEmpty()) {
                                    cartRecycler.visibility = View.GONE
                                    cartEmptyCard.visibility = View.VISIBLE
                                    cartTotalText.visibility = View.GONE
                                    checkoutOrderBtn.visibility = View.GONE
                                } else {
                                    cartEmptyCard.visibility = View.GONE
                                    cartRecycler.visibility = View.VISIBLE
                                    cartTotalText.visibility = View.VISIBLE
                                    checkoutOrderBtn.visibility = View.VISIBLE
                                    cartTotalText.text = "Итого: ${priceStr(r.data.total)}"
                                    currentCartItems = items
                                    cartAdapter.setData(items)
                                }
                            }
                            else -> {
                                cartRecycler.visibility = View.GONE
                                cartEmptyCard.visibility = View.VISIBLE
                                cartTotalText.visibility = View.GONE
                                checkoutOrderBtn.visibility = View.GONE
                            }
                        }
                        if (currentPageId == R.id.action_profile && sessionManager.isLoggedIn) {
                            refreshProfileStats()
                        }
                    }
                }.start()
            }
        }

        checkoutOrderBtn.setOnClickListener {
            if (!sessionManager.isLoggedIn) {
                Snackbar.make(buildPage, "Войдите в аккаунт для оформления заказа", Snackbar.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (currentCartItems.isEmpty()) {
                Snackbar.make(buildPage, "Корзина пуста", Snackbar.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val v = LayoutInflater.from(this).inflate(R.layout.dialog_checkout_order, null)
            val nameInput = v.findViewById<TextInputEditText>(R.id.checkoutName)
            val phoneInput = v.findViewById<TextInputEditText>(R.id.checkoutPhone)
            val emailInput = v.findViewById<TextInputEditText>(R.id.checkoutEmail)
            val addressInput = v.findViewById<TextInputEditText>(R.id.checkoutAddress)
            val commentInput = v.findViewById<TextInputEditText>(R.id.checkoutComment)
            nameInput.setText(sessionManager.userName ?: "")
            emailInput.setText(sessionManager.userEmail ?: "")
            MaterialAlertDialogBuilder(this)
                .setTitle(getString(R.string.checkout_title))
                .setView(v)
                .setPositiveButton("Оформить") { _, _ ->
                    val n = nameInput.text?.toString()?.trim().orEmpty()
                    val p = phoneInput.text?.toString()?.trim().orEmpty()
                    val e = emailInput.text?.toString()?.trim().orEmpty()
                    val a = addressInput.text?.toString()?.trim().orEmpty()
                    val c = commentInput.text?.toString()?.trim()?.takeIf { it.isNotBlank() }
                    if (n.isBlank() || p.isBlank() || e.isBlank() || a.isBlank()) {
                        Snackbar.make(buildPage, "Заполните обязательные поля", Snackbar.LENGTH_SHORT).show()
                        return@setPositiveButton
                    }
                    Thread {
                        val r = BuildsApi.createOrder(sessionManager.token, n, p, e, a, c)
                        runOnUiThread {
                            when (r) {
                                is BuildsApi.ApiResult.Success -> {
                                    Snackbar.make(buildPage, "Заказ #${r.data.id} оформлен", Snackbar.LENGTH_LONG).show()
                                    loadCart()
                                    maybeCheckOrderNotifications(force = true)
                                }
                                is BuildsApi.ApiResult.Error -> Snackbar.make(buildPage, r.message, Snackbar.LENGTH_SHORT).show()
                            }
                        }
                    }.start()
                }
                .setNegativeButton("Отмена", null)
                .show()
        }

        fun showCreateBuildDialogAndCreate() {
            if (!sessionManager.isLoggedIn) {
                Snackbar.make(buildPage, "Войдите в аккаунт для создания сборок", Snackbar.LENGTH_LONG).show()
                return
            }
            val editLayout = android.widget.LinearLayout(this).apply {
                orientation = android.widget.LinearLayout.VERTICAL
                setPadding(48, 24, 48, 24)
            }
            val input = TextInputEditText(this).apply {
                setHint("Название сборки")
                setText("Новая сборка")
                setSingleLine(true)
                minimumWidth = 300
            }
            editLayout.addView(input)
            val dialog = MaterialAlertDialogBuilder(this)
                .setTitle("Создать сборку")
                .setView(editLayout)
                .setPositiveButton("Создать") { _, _ ->
                    val name = input.text?.toString()?.trim().takeIf { !it.isNullOrBlank() } ?: "Новая сборка"
                    Thread {
                        val r = BuildsApi.createBuild(sessionManager.token, name)
                        runOnUiThread {
                            when (r) {
                                is BuildsApi.ApiResult.Success -> {
                                    currentBuildId = r.data.id
                                    buildListInclude.visibility = View.GONE
                                    buildDetailInclude.visibility = View.VISIBLE
                                    buildDetailName.text = r.data.name
                                    loadBuildDetail(r.data.id)
                                    loadBuildsList()
                                    refreshHomeBuildsCard?.invoke()
                                }
                                is BuildsApi.ApiResult.Error -> Snackbar.make(buildPage, r.message, Snackbar.LENGTH_SHORT).show()
                            }
                        }
                    }.start()
                }
                .setNegativeButton("Отмена", null)
                .create()
            dialog.show()
        }

        createBtn.setOnClickListener { showCreateBuildDialogAndCreate() }
        createBtnHeader.setOnClickListener { showCreateBuildDialogAndCreate() }

        val buildDetailDelete = buildPage.findViewById<MaterialButton>(R.id.buildDetailDelete)
        buildDetailDelete.setOnClickListener {
            val bid = currentBuildId ?: return@setOnClickListener
            MaterialAlertDialogBuilder(this)
                .setTitle("Удалить сборку?")
                .setMessage("Сборка будет удалена без возможности восстановления.")
                .setPositiveButton("Удалить") { _, _ ->
                    Thread {
                        val r = BuildsApi.deleteBuild(sessionManager.token, bid)
                        runOnUiThread {
                            when (r) {
                                is BuildsApi.ApiResult.Success -> {
                                    currentBuildId = null
                                    lastBuildDetail = null
                                    buildDetailInclude.visibility = View.GONE
                                    buildListInclude.visibility = View.VISIBLE
                                    loadBuildsList()
                                    refreshHomeBuildsCard?.invoke()
                                    Snackbar.make(buildPage, "Сборка удалена", Snackbar.LENGTH_SHORT).show()
                                }
                                is BuildsApi.ApiResult.Error -> Snackbar.make(buildPage, r.message, Snackbar.LENGTH_SHORT).show()
                            }
                        }
                    }.start()
                }
                .setNegativeButton("Отмена", null)
                .show()
        }

        buildDetailBack.setOnClickListener {
            buildDetailInclude.visibility = View.GONE
            buildListInclude.visibility = View.VISIBLE
            currentBuildId = null
            lastBuildDetail = null
            loadBuildsList()
        }

        buildDetailShare.setOnClickListener {
            val d = lastBuildDetail
            if (d == null) {
                Snackbar.make(buildPage, "Подождите загрузки сборки", Snackbar.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            shareBuildText(d)
        }

        buildDetailDuplicate.setOnClickListener {
            if (!sessionManager.isLoggedIn) {
                Snackbar.make(buildPage, "Войдите в аккаунт", Snackbar.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val d = lastBuildDetail
            if (d == null) {
                Snackbar.make(buildPage, "Подождите загрузки сборки", Snackbar.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            MaterialAlertDialogBuilder(this)
                .setTitle("Копировать сборку?")
                .setMessage("Будет создана копия «${d.name}» со всеми комплектующими.")
                .setPositiveButton("Копировать") { _, _ ->
                    Thread {
                        val stem = stemBuildNameForCopy(d.name)
                        var newId: Int? = null
                        var n = 2
                        while (n < 100) {
                            val candidate = getString(R.string.duplicate_build_numbered, stem, n)
                            when (val created = BuildsApi.createBuild(sessionManager.token, candidate)) {
                                is BuildsApi.ApiResult.Success -> {
                                    newId = created.data.id
                                    break
                                }
                                is BuildsApi.ApiResult.Error -> {
                                    val clash = created.message.contains("уже существует", ignoreCase = true)
                                    if (!clash) {
                                        runOnUiThread { Snackbar.make(buildPage, created.message, Snackbar.LENGTH_LONG).show() }
                                        return@Thread
                                    }
                                    n++
                                }
                            }
                        }
                        val bid = newId
                        if (bid == null) {
                            runOnUiThread { Snackbar.make(buildPage, "Не удалось подобрать уникальное имя копии", Snackbar.LENGTH_LONG).show() }
                            return@Thread
                        }
                        var err: String? = null
                        for (c in d.components ?: emptyList()) {
                            when (val addR = BuildsApi.addToBuild(sessionManager.token, bid, c.component_id, c.quantity)) {
                                is BuildsApi.ApiResult.Error -> err = addR.message
                                else -> {}
                            }
                        }
                        runOnUiThread {
                            if (err != null) {
                                Snackbar.make(buildPage, "Копия создана, часть позиций не добавилась: $err", Snackbar.LENGTH_LONG).show()
                            } else {
                                Snackbar.make(buildPage, "Сборка скопирована", Snackbar.LENGTH_SHORT).show()
                            }
                            currentBuildId = bid
                            buildListInclude.visibility = View.GONE
                            buildDetailInclude.visibility = View.VISIBLE
                            loadBuildDetail(bid)
                            loadBuildsList()
                            refreshHomeBuildsCard?.invoke()
                        }
                    }.start()
                }
                .setNegativeButton("Отмена", null)
                .show()
        }

        val componentPickerInclude = buildPage.findViewById<View>(R.id.componentPickerInclude)
        val componentPickerBack = buildPage.findViewById<MaterialButton>(R.id.componentPickerBack)
        val componentPickerSearchInput = buildPage.findViewById<com.google.android.material.textfield.TextInputEditText>(R.id.componentPickerSearchInput)
        val componentPickerTabs = buildPage.findViewById<TabLayout>(R.id.componentPickerTabs)
        val componentPickerTabLeft = buildPage.findViewById<ImageButton>(R.id.componentPickerTabLeft)
        val componentPickerTabRight = buildPage.findViewById<ImageButton>(R.id.componentPickerTabRight)
        val componentPickerRecyclerFull = buildPage.findViewById<RecyclerView>(R.id.componentPickerRecyclerFull)
        componentPickerRecyclerFull.layoutManager = LinearLayoutManager(this)
        val pickerAdapter = ComponentsAdapter(emptyList(),
            onAddToBuild = { c ->
                val bid = currentBuildId ?: return@ComponentsAdapter
                Thread {
                    val r = BuildsApi.addToBuild(sessionManager.token, bid, c.id, 1)
                    runOnUiThread {
                        when (r) {
                            is BuildsApi.ApiResult.Success -> {
                                Snackbar.make(buildPage, "Добавлено в сборку", Snackbar.LENGTH_SHORT).show()
                                currentBuildId?.let { loadBuildDetail(it) }
                            }
                            is BuildsApi.ApiResult.Error ->
                                Snackbar.make(buildPage, r.message, Snackbar.LENGTH_LONG).show()
                        }
                    }
                }.start()
            },
            onAddToCart = { c ->
                Thread {
                    val r = BuildsApi.addToCart(sessionManager.token, c.id, 1)
                    runOnUiThread {
                        if (r is BuildsApi.ApiResult.Success) Snackbar.make(buildPage, "Добавлено в корзину", Snackbar.LENGTH_SHORT).show()
                        else Snackbar.make(buildPage, (r as BuildsApi.ApiResult.Error).message, Snackbar.LENGTH_SHORT).show()
                    }
                }.start()
            }
        )
        componentPickerRecyclerFull.adapter = pickerAdapter

        var pickerCategories = emptyList<BuildsApi.Category>()
        var pickerSearchQuery = ""
        val pickerSearchHandler = Handler(Looper.getMainLooper())
        var pickerSearchRunnable: Runnable? = null
        fun loadPickerComponents(catId: Int?, search: String?) {
            Thread {
                val res = BuildsApi.components(sessionManager.token, catId, search?.trim()?.takeIf { it.isNotEmpty() })
                runOnUiThread { if (res is BuildsApi.ApiResult.Success) pickerAdapter.setData(res.data) }
            }.start()
        }
        componentPickerSearchInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                pickerSearchQuery = s?.toString() ?: ""
                pickerSearchRunnable?.let { pickerSearchHandler.removeCallbacks(it) }
                pickerSearchRunnable = Runnable {
                    val pos = componentPickerTabs.selectedTabPosition
                    val catId = pickerCategories.getOrNull(pos)?.id
                    loadPickerComponents(catId, pickerSearchQuery)
                }
                pickerSearchHandler.postDelayed(pickerSearchRunnable!!, 400)
            }
        })
        componentPickerSearchInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                val q = componentPickerSearchInput.text?.toString()?.trim() ?: ""
                pickerSearchQuery = q
                val catId = pickerCategories.getOrNull(componentPickerTabs.selectedTabPosition)?.id
                loadPickerComponents(catId, pickerSearchQuery)
                true
            } else false
        }
        fun updatePickerTabArrows() {
            val count = componentPickerTabs.tabCount
            val pos = componentPickerTabs.selectedTabPosition
            componentPickerTabLeft.isEnabled = count > 1 && pos > 0
            componentPickerTabRight.isEnabled = count > 1 && pos < count - 1
            componentPickerTabLeft.alpha = if (componentPickerTabLeft.isEnabled) 1f else 0.4f
            componentPickerTabRight.alpha = if (componentPickerTabRight.isEnabled) 1f else 0.4f
        }
        componentPickerTabLeft.setOnClickListener {
            val pos = componentPickerTabs.selectedTabPosition
            if (pos > 0) componentPickerTabs.getTabAt(pos - 1)?.select()
        }
        componentPickerTabRight.setOnClickListener {
            val pos = componentPickerTabs.selectedTabPosition
            if (pos < componentPickerTabs.tabCount - 1) componentPickerTabs.getTabAt(pos + 1)?.select()
        }
        componentPickerTabs.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab?) {
                val pos = tab?.position ?: 0
                val catId = pickerCategories.getOrNull(pos)?.id ?: return
                loadPickerComponents(catId, pickerSearchQuery)
                updatePickerTabArrows()
            }
            override fun onTabUnselected(t: TabLayout.Tab?) {}
            override fun onTabReselected(t: TabLayout.Tab?) {}
        })

        fun openComponentPickerFull(categorySlug: String? = null) {
            if (categorySlug != null) pendingPickerSearchQuery = null
            if (sessionManager.token.isNullOrBlank()) {
                Snackbar.make(buildPage, "Войдите в аккаунт", Snackbar.LENGTH_SHORT).show()
                return
            }
            buildDetailInclude.visibility = View.GONE
            buildListInclude.visibility = View.GONE
            componentPickerInclude.visibility = View.VISIBLE
            Thread {
                val catRes = BuildsApi.categories(sessionManager.token)
                runOnUiThread {
                    when (catRes) {
                        is BuildsApi.ApiResult.Success -> {
                            pickerCategories = catRes.data
                            componentPickerTabs.removeAllTabs()
                            pickerCategories.forEach { cat -> componentPickerTabs.addTab(componentPickerTabs.newTab().setText(cat.name)) }
                            pickerSearchQuery = ""
                            componentPickerSearchInput.setText("")
                            val tabIndex = if (categorySlug != null) {
                                pickerCategories.indexOfFirst { it.slug == categorySlug }.takeIf { it >= 0 } ?: 0
                            } else 0
                            val catId = pickerCategories.getOrNull(tabIndex)?.id
                            if (catId != null) {
                                componentPickerTabs.getTabAt(tabIndex)?.select()
                                loadPickerComponents(catId, null)
                            } else if (pickerCategories.isNotEmpty()) {
                                loadPickerComponents(pickerCategories[0].id, null)
                            }
                            updatePickerTabArrows()
                            val pending = pendingPickerSearchQuery
                            if (!pending.isNullOrEmpty()) {
                                pendingPickerSearchQuery = null
                                pickerSearchQuery = pending
                                componentPickerSearchInput.setText(pending)
                                val pos = componentPickerTabs.selectedTabPosition
                                val cid = pickerCategories.getOrNull(pos)?.id
                                if (cid != null) loadPickerComponents(cid, pending)
                            }
                        }
                        is BuildsApi.ApiResult.Error -> Snackbar.make(buildPage, catRes.message, Snackbar.LENGTH_SHORT).show()
                    }
                }
            }.start()
        }

        openBuildPageWithCategory = { slug ->
            showPageById(R.id.navigation_build)
            openComponentPickerFull(slug)
        }

        createPresetBuildAndOpen = inner@{ displayName, preset ->
            if (!sessionManager.isLoggedIn) {
                Snackbar.make(buildPage, "Войдите в аккаунт для создания сборки", Snackbar.LENGTH_SHORT).show()
                showPageById(R.id.navigation_build)
                return@inner
            }
            Thread {
                val r = BuildsApi.createBuildFromPreset(sessionManager.token, displayName, preset)
                runOnUiThread {
                    when (r) {
                        is BuildsApi.ApiResult.Success -> {
                            currentBuildId = r.data.id
                            buildListInclude.visibility = View.GONE
                            buildDetailInclude.visibility = View.VISIBLE
                            buildDetailName.text = r.data.name
                            loadBuildDetail(r.data.id)
                            loadBuildsList()
                            refreshHomeBuildsCard?.invoke()
                            showPageById(R.id.navigation_build)
                        }
                        is BuildsApi.ApiResult.Error -> Snackbar.make(buildPage, r.message, Snackbar.LENGTH_LONG).show()
                    }
                }
            }.start()
        }

        componentPickerBack.setOnClickListener {
            componentPickerInclude.visibility = View.GONE
            if (currentBuildId != null) {
                buildDetailInclude.visibility = View.VISIBLE
                buildListInclude.visibility = View.GONE
                loadBuildDetail(currentBuildId!!)
            } else {
                buildListInclude.visibility = View.VISIBLE
                buildDetailInclude.visibility = View.GONE
            }
        }

        buildDetailAddBtn.setOnClickListener {
            openComponentPickerFull()
        }

        buildDetailAddBuildToCart.setOnClickListener {
            val bid = currentBuildId ?: return@setOnClickListener
            Thread {
                val r = BuildsApi.addBuildToCart(sessionManager.token, bid)
                runOnUiThread {
                    when (r) {
                        is BuildsApi.ApiResult.Success -> {
                            Snackbar.make(buildPage, "Сборка добавлена в корзину", Snackbar.LENGTH_SHORT).show()
                            loadCartCallback?.invoke()
                        }
                        is BuildsApi.ApiResult.Error -> Snackbar.make(buildPage, r.message, Snackbar.LENGTH_SHORT).show()
                    }
                }
            }.start()
        }

        goToShoppingBtn.setOnClickListener {
            val tabs = buildPage.findViewById<TabLayout>(R.id.buildMainTabs)
            tabs.getTabAt(0)?.select()
            openBuildPageWithCategory?.invoke(null)
        }

        refreshBuildList = loadBuildsList
        loadCartCallback = loadCart

        buildPage.findViewById<View>(R.id.buildPageContentContainer).post {
            loadBuildsList()
        }
    }

    private fun setupAuthScreen() {
        val modeToggle = findViewById<MaterialButtonToggleGroup>(R.id.authModeToggle)
        val nameLayout = findViewById<View>(R.id.authNameLayout)
        val nameInput = findViewById<TextInputEditText>(R.id.authNameInput)
        val emailInput = findViewById<TextInputEditText>(R.id.authEmailInput)
        val passwordInput = findViewById<TextInputEditText>(R.id.authPasswordInput)
        val errorText = findViewById<TextView>(R.id.authErrorText)
        val rememberSwitch = findViewById<MaterialSwitch>(R.id.authRememberSwitch)
        val submitBtn = findViewById<MaterialButton>(R.id.authSubmitButton)
        val guestBtn = findViewById<MaterialButton>(R.id.authGuestButton)

        fun updateAuthFormMode(isRegister: Boolean) {
            nameLayout.visibility = if (isRegister) View.VISIBLE else View.GONE
            submitBtn.text = if (isRegister) getString(R.string.auth_register) else getString(R.string.auth_login)
        }
        updateAuthFormMode(false)
        modeToggle.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            updateAuthFormMode(checkedId == R.id.authModeRegister)
            errorText.visibility = View.GONE
        }

        submitBtn.setOnClickListener {
            val isRegister = modeToggle.checkedButtonId == R.id.authModeRegister
            val email = emailInput.text?.toString()?.trim().orEmpty()
            val password = passwordInput.text?.toString().orEmpty()
            val name = nameInput.text?.toString()?.trim().orEmpty()
            when {
                email.isEmpty() || !email.contains('@') -> {
                    errorText.visibility = View.VISIBLE
                    errorText.text = getString(R.string.auth_err_email)
                }
                password.length < 6 -> {
                    errorText.visibility = View.VISIBLE
                    errorText.text = getString(R.string.auth_err_password)
                }
                isRegister && name.length < 2 -> {
                    errorText.visibility = View.VISIBLE
                    errorText.text = getString(R.string.auth_err_name)
                }
                else -> {
                    errorText.visibility = View.GONE
                    submitBtn.isEnabled = false
                    if (isRegister) {
                        Thread {
                            val result = AuthApi.register(email, password, name)
                            runOnUiThread {
                                submitBtn.isEnabled = true
                                when (result) {
                                    is AuthApi.ApiResult.Success ->
                                        showVerifyEmailDialog(email, rememberSwitch.isChecked)
                                    is AuthApi.ApiResult.Error -> {
                                        errorText.visibility = View.VISIBLE
                                        errorText.text = result.message
                                    }
                                }
                            }
                        }.start()
                    } else {
                        Thread {
                            val result = AuthApi.login(email, password)
                            runOnUiThread {
                                submitBtn.isEnabled = true
                                when (result) {
                                    is AuthApi.ApiResult.Success -> {
                                        sessionManager.saveUser(
                                            result.data.token,
                                            result.data.user,
                                            rememberSwitch.isChecked
                                        )
                                        hideAuthOverlay()
                                        updateProfileUI()
                                        refreshHomeBuildsCard?.invoke()
                                        updateOrdersTabVisibility()
                                        refreshOrdersCallback?.invoke()
                                        bottomNavigationView.selectedItemId = R.id.navigation_home
                                    }
                                    is AuthApi.ApiResult.Error -> {
                                        errorText.visibility = View.VISIBLE
                                        errorText.text = result.message
                                    }
                                }
                            }
                        }.start()
                    }
                }
            }
        }

        guestBtn.setOnClickListener {
            sessionManager.enterGuestMode()
            hideAuthOverlay()
            updateProfileUI()
            refreshHomeBuildsCard?.invoke()
            updateOrdersTabVisibility()
            bottomNavigationView.selectedItemId = R.id.navigation_home
        }

        if (sessionManager.shouldShowAuthOnLaunch()) {
            showAuthOverlay(registerMode = false)
        } else {
            hideAuthOverlay()
        }
    }

    private fun showVerifyEmailDialog(email: String, rememberMe: Boolean) {
        val ctx = this
        val inputLayout = com.google.android.material.textfield.TextInputLayout(ctx).apply {
            hint = "6-значный код"
            setPadding(0, 16, 0, 0)
        }
        val codeInput = TextInputEditText(ctx).apply {
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            maxLines = 1
            filters = arrayOf(android.text.InputFilter.LengthFilter(6))
        }
        inputLayout.addView(codeInput)

        val container = android.widget.LinearLayout(ctx).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(64, 16, 64, 0)
        }
        val hint = TextView(ctx).apply {
            text = "Код отправлен на\n$email"
            textAlignment = View.TEXT_ALIGNMENT_CENTER
        }
        container.addView(hint)
        container.addView(inputLayout)

        val dialog = MaterialAlertDialogBuilder(ctx)
            .setTitle("Подтверждение email")
            .setView(container)
            .setPositiveButton("Подтвердить", null)
            .setNegativeButton("Отмена", null)
            .create()

        dialog.setOnShowListener {
            val btn = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
            btn.setOnClickListener {
                val code = codeInput.text?.toString()?.trim().orEmpty()
                if (code.length != 6) {
                    codeInput.error = "Введите 6-значный код"
                    return@setOnClickListener
                }
                btn.isEnabled = false
                Thread {
                    val result = AuthApi.verifyEmail(email, code)
                    runOnUiThread {
                        btn.isEnabled = true
                        when (result) {
                            is AuthApi.ApiResult.Success -> {
                                dialog.dismiss()
                                sessionManager.saveUser(result.data.token, result.data.user, rememberMe)
                                hideAuthOverlay()
                                updateProfileUI()
                                refreshHomeBuildsCard?.invoke()
                                updateOrdersTabVisibility()
                                refreshOrdersCallback?.invoke()
                                bottomNavigationView.selectedItemId = R.id.navigation_home
                            }
                            is AuthApi.ApiResult.Error -> {
                                codeInput.error = result.message
                            }
                        }
                    }
                }.start()
            }
        }
        dialog.show()
    }

    private fun showAuthOverlay(registerMode: Boolean = false) {
        authOverlay.visibility = View.VISIBLE
        topAppBar.visibility = View.GONE
        bottomNavigationView.visibility = View.GONE
        authBackCallback.isEnabled = true
        findViewById<MaterialButtonToggleGroup>(R.id.authModeToggle).check(
            if (registerMode) R.id.authModeRegister else R.id.authModeLogin
        )
        findViewById<TextView>(R.id.authErrorText).visibility = View.GONE
    }

    private fun hideAuthOverlay() {
        authOverlay.visibility = View.GONE
        topAppBar.visibility = View.VISIBLE
        bottomNavigationView.visibility = View.VISIBLE
        authBackCallback.isEnabled = false
        updateOrdersTabVisibility()
        maybeCheckOrderNotifications(force = true)
    }

    private fun updateOrdersTabVisibility() {
        val item = bottomNavigationView.menu.findItem(R.id.navigation_orders) ?: return
        // Вкладка заказов доступна всем авторизованным пользователям:
        // customer видит "мои заказы", assembler — "назначенные".
        item.isVisible = sessionManager.isLoggedIn
        if (!item.isVisible) {
            clearOrdersTabBadge()
            if (currentPageId == R.id.navigation_orders) {
                showPageById(R.id.navigation_home)
            }
        }
    }

    /** Бейдж по числу непрочитанных уведомлений о заказах (новый заказ / смена статуса и т.д.). */
    private fun updateOrdersTabBadge(unreadCount: Int) {
        if (!sessionManager.isLoggedIn) {
            clearOrdersTabBadge()
            return
        }
        val badge = try {
            bottomNavigationView.getOrCreateBadge(R.id.navigation_orders)
        } catch (_: Exception) {
            return
        }
        if (unreadCount <= 0) {
            badge.isVisible = false
            return
        }
        badge.isVisible = true
        badge.number = unreadCount.coerceAtMost(99)
        badge.badgeGravity = BadgeDrawable.TOP_END
    }

    private fun clearOrdersTabBadge() {
        try {
            bottomNavigationView.removeBadge(R.id.navigation_orders)
        } catch (_: Exception) {
            try {
                bottomNavigationView.getOrCreateBadge(R.id.navigation_orders).isVisible = false
            } catch (_: Exception) { }
        }
    }

    private fun maybeCheckOrderNotifications(force: Boolean = false) {
        if (!sessionManager.isLoggedIn) {
            clearOrdersTabBadge()
            return
        }
        val notificationsEnabled = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(NOTIFICATIONS_KEY, true)
        if (!notificationsEnabled) {
            clearOrdersTabBadge()
            return
        }
        val now = System.currentTimeMillis()
        if (!force && now - lastOrderNotificationCheckAt < 30_000L) return
        lastOrderNotificationCheckAt = now
        val token = sessionManager.token ?: return
        launchIo(
            work = { BuildsApi.myOrderNotifications(token) },
            onMain = { r ->
                if (r is BuildsApi.ApiResult.Success) {
                    val list = r.data
                    val unread = list.count { !it.is_read }
                    updateOrdersTabBadge(unread)
                    val newestUnread = list.firstOrNull { !it.is_read }
                    if (newestUnread != null &&
                        newestUnread.id != lastOrderNotificationId &&
                        currentPageId != R.id.navigation_orders
                    ) {
                        lastOrderNotificationId = newestUnread.id
                        Snackbar.make(
                            findViewById(R.id.main),
                            "${newestUnread.title}\n${newestUnread.body}",
                            Snackbar.LENGTH_LONG
                        ).show()
                    }
                }
            },
        )
    }

    private fun setupProfileListeners() {
        profilePage.findViewById<MaterialButton>(R.id.profileLoginButton).setOnClickListener {
            showAuthOverlay(registerMode = false)
        }
        profilePage.findViewById<MaterialButton>(R.id.profileRegisterButton).setOnClickListener {
            showAuthOverlay(registerMode = true)
        }
        profilePage.findViewById<MaterialButton>(R.id.profileLogoutButton).setOnClickListener {
            sessionManager.logout()
            updateOrdersTabVisibility()
            updateProfileUI()
            refreshHomeBuildsCard?.invoke()
            showAuthOverlay(registerMode = false)
        }
        profilePage.findViewById<MaterialButton>(R.id.profileEditButton).setOnClickListener {
            showEditProfileDialog()
        }
        profilePage.findViewById<ImageButton>(R.id.profileCopyEmailButton).setOnClickListener {
            val email = sessionManager.userEmail?.trim().orEmpty()
            if (email.isEmpty()) return@setOnClickListener
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("email", email))
            Snackbar.make(profilePage, getString(R.string.profile_email_copied), Snackbar.LENGTH_SHORT).show()
        }
        setupProfileQuickNav()
    }

    /** Быстрые переходы: сборки, корзина, ИИ, настройки. */
    private fun setupProfileQuickNav() {
        val container = profilePage.findViewById<LinearLayout>(R.id.profileQuickNavContainer)
        if (container.childCount > 0) return
        val inflater = LayoutInflater.from(this)
        data class NavItem(val icon: Int, val title: String, val subtitle: String, val action: () -> Unit)
        val items = listOf(
            NavItem(R.drawable.ic_build, getString(R.string.profile_nav_builds), getString(R.string.profile_nav_builds_sub)) {
                showPageById(R.id.navigation_build)
            },
            NavItem(R.drawable.ic_cart, getString(R.string.profile_nav_cart), getString(R.string.profile_nav_cart_sub)) {
                showPageById(R.id.navigation_build)
                buildPage.post {
                    val tabs = buildPage.findViewById<TabLayout>(R.id.buildMainTabs)
                    tabs.getTabAt(1)?.select()
                }
            },
            NavItem(R.drawable.ic_ai, getString(R.string.profile_nav_ai), getString(R.string.profile_nav_ai_sub)) {
                showPageById(R.id.navigation_ai_chat)
            },
            NavItem(R.drawable.ic_settings, getString(R.string.profile_nav_settings), getString(R.string.profile_nav_settings_sub)) {
                showPageById(R.id.action_settings)
            },
        )
        for (item in items) {
            val row = inflater.inflate(R.layout.item_profile_nav_row, container, false)
            row.findViewById<ImageView>(R.id.profileNavIcon).setImageResource(item.icon)
            row.findViewById<TextView>(R.id.profileNavTitle).text = item.title
            row.findViewById<TextView>(R.id.profileNavSubtitle).text = item.subtitle
            row.setOnClickListener { item.action() }
            container.addView(row)
        }
    }

    /** Подгружает статистику профиля (один запрос к API). */
    private fun refreshProfileStats() {
        if (!sessionManager.isLoggedIn) return
        val buildsTv = profilePage.findViewById<TextView>(R.id.profileStatBuildsValue)
        val cartTv = profilePage.findViewById<TextView>(R.id.profileStatCartValue)
        val cartTotalTv = profilePage.findViewById<TextView>(R.id.profileStatCartTotalValue)
        val cartLinesTv = profilePage.findViewById<TextView>(R.id.profileStatCartLinesValue)
        val slotsTv = profilePage.findViewById<TextView>(R.id.profileStatBuildSlotsValue)
        val memberTv = profilePage.findViewById<TextView>(R.id.profileStatMemberSinceValue)
        Thread {
            when (val res = BuildsApi.userStats(sessionManager.token)) {
                is BuildsApi.ApiResult.Success -> {
                    val s = res.data
                    runOnUiThread {
                        buildsTv.text = s.buildsCount.toString()
                        cartTv.text = s.cartQuantity.toString()
                        cartTotalTv.text = priceStr(s.cartTotalRub)
                        cartLinesTv.text = s.cartLines.toString()
                        slotsTv.text = s.buildComponentSlots.toString()
                        memberTv.text = formatMemberSince(s.memberSince)
                    }
                    if (s.memberSince.isNullOrBlank()) {
                        val tok = sessionManager.token
                        if (!tok.isNullOrBlank()) {
                            Thread {
                                when (val mr = AuthApi.me(tok)) {
                                    is AuthApi.ApiResult.Success -> {
                                        val label = formatMemberSince(mr.data.user.createdAt)
                                        if (label != "—") {
                                            runOnUiThread { memberTv.text = label }
                                        }
                                    }
                                    else -> {}
                                }
                            }.start()
                        }
                    }
                }
                else -> applyProfileStatsFallback(
                    buildsTv,
                    cartTv,
                    cartTotalTv,
                    cartLinesTv,
                    slotsTv,
                    memberTv,
                )
            }
        }.start()
    }

    /**
     * Если GET /api/stats/me недоступен (404, старый сервер), заполняем сводку из /api/builds,
     * /api/cart и /api/auth/me — те же данные, что считает stats на бэкенде.
     */
    private fun applyProfileStatsFallback(
        buildsTv: TextView,
        cartTv: TextView,
        cartTotalTv: TextView,
        cartLinesTv: TextView,
        slotsTv: TextView,
        memberTv: TextView,
    ) {
        val token = sessionManager.token ?: run {
            runOnUiThread {
                buildsTv.text = "0"
                cartTv.text = "0"
                cartTotalTv.text = "—"
                cartLinesTv.text = "—"
                slotsTv.text = "—"
                memberTv.text = "—"
            }
            return
        }
        var buildsCount = 0
        var slots = 0
        when (val br = BuildsApi.builds(token)) {
            is BuildsApi.ApiResult.Success -> {
                val list = br.data
                buildsCount = list.size
                for (b in list.take(50)) {
                    when (val dr = BuildsApi.buildDetail(token, b.id)) {
                        is BuildsApi.ApiResult.Success -> {
                            val comps = dr.data.components.orEmpty()
                            for (c in comps) slots += c.quantity
                        }
                        else -> {}
                    }
                }
            }
            else -> {}
        }
        var cartQty = 0
        var cartLines = 0
        var cartTotalLabel = "—"
        when (val cr = BuildsApi.cart(token)) {
            is BuildsApi.ApiResult.Success -> {
                val items = cr.data.items
                cartLines = items.size
                cartQty = items.sumOf { it.quantity }
                cartTotalLabel = priceStr(cr.data.total)
            }
            else -> {}
        }
        var memberLabel = "—"
        when (val mr = AuthApi.me(token)) {
            is AuthApi.ApiResult.Success -> {
                memberLabel = formatMemberSince(mr.data.user.createdAt)
            }
            else -> {}
        }
        runOnUiThread {
            buildsTv.text = buildsCount.toString()
            cartTv.text = cartQty.toString()
            cartTotalTv.text = cartTotalLabel
            cartLinesTv.text = cartLines.toString()
            slotsTv.text = slots.toString()
            memberTv.text = memberLabel
        }
    }

    private fun formatMemberSince(raw: String?): String {
        if (raw.isNullOrBlank()) return "—"
        val trimmed = raw.trim()
        return try {
            val outFmt = SimpleDateFormat("d MMMM yyyy", Locale("ru", "RU"))
            val utc = TimeZone.getTimeZone("UTC")
            val parsers = listOf(
                SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = utc },
                SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = utc },
                SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US),
                SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US),
                SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).apply { timeZone = utc },
                SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = utc },
            )
            for (p in parsers) {
                try {
                    val d = p.parse(trimmed) ?: continue
                    return outFmt.format(d)
                } catch (_: Exception) {
                    continue
                }
            }
            if (trimmed.length >= 10) trimmed.take(10) else "—"
        } catch (_: Exception) {
            if (trimmed.length >= 10) trimmed.take(10) else "—"
        }
    }

    private fun updateProfileUI() {
        updateOrdersTabVisibility()
        val heroSub = profilePage.findViewById<TextView>(R.id.profileHeroSubtitle)
        val guestCard = profilePage.findViewById<View>(R.id.profileGuestCard)
        val userCard = profilePage.findViewById<View>(R.id.profileUserCard)
        if (sessionManager.isLoggedIn) {
            val greetName =
                sessionManager.userName?.trim()?.split(Regex("\\s+"))?.firstOrNull { it.isNotEmpty() } ?: "коллега"
            heroSub.text = getString(R.string.profile_hero_user_hint, greetName)
            guestCard.visibility = View.GONE
            userCard.visibility = View.VISIBLE
            profilePage.findViewById<TextView>(R.id.profileUserName).text = sessionManager.userName ?: ""
            profilePage.findViewById<TextView>(R.id.profileUserEmail).text = sessionManager.userEmail ?: ""
            val avatarImage = profilePage.findViewById<ImageView>(R.id.profileAvatarImage)
            val avatarInitials = profilePage.findViewById<TextView>(R.id.profileAvatarInitials)
            val avatarUrl = sessionManager.userAvatarUrl?.trim()
            if (!avatarUrl.isNullOrEmpty()) {
                avatarInitials.visibility = View.GONE
                avatarImage.visibility = View.VISIBLE
                avatarImage.load(avatarUrl) {
                    listener(
                        onError = { _, _ ->
                            runOnUiThread {
                                avatarImage.visibility = View.GONE
                                avatarInitials.visibility = View.VISIBLE
                                avatarInitials.text = profileInitials(sessionManager.userName)
                            }
                        }
                    )
                }
            } else {
                avatarImage.visibility = View.GONE
                avatarInitials.visibility = View.VISIBLE
                avatarInitials.text = profileInitials(sessionManager.userName)
            }
            refreshProfileStats()
        } else {
            heroSub.text = getString(R.string.profile_hero_guest_hint)
            guestCard.visibility = View.VISIBLE
            userCard.visibility = View.GONE
            val guestTitle = profilePage.findViewById<TextView>(R.id.profileGuestTitle)
            val guestBody = profilePage.findViewById<TextView>(R.id.profileGuestBody)
            if (sessionManager.isGuestMode) {
                guestTitle.setText(R.string.profile_guest_mode_title)
                guestBody.setText(R.string.profile_guest_mode_body)
            } else {
                guestTitle.setText(R.string.profile_guest_title)
                guestBody.setText(R.string.profile_guest_body)
            }
        }
    }

    private fun profileInitials(name: String?): String {
        if (name.isNullOrBlank()) return "?"
        val parts = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        return when {
            parts.size >= 2 -> "${parts[0].first().uppercaseChar()}${parts[1].first().uppercaseChar()}"
            parts.size == 1 -> parts[0].first().uppercaseChar().toString()
            else -> "?"
        }
    }

    private fun showEditProfileDialog() {
        val view = LayoutInflater.from(this).inflate(R.layout.dialog_edit_profile, null)
        val nameInput = view.findViewById<TextInputEditText>(R.id.editProfileName)
        val avatarUrlInput = view.findViewById<TextInputEditText>(R.id.editProfileAvatarUrl)
        nameInput.setText(sessionManager.userName ?: "")
        avatarUrlInput.setText(sessionManager.userAvatarUrl ?: "")
        val dialog = MaterialAlertDialogBuilder(this)
            .setView(view)
            .setPositiveButton("Сохранить") { _, _ ->
                val name = nameInput.text?.toString()?.trim().orEmpty()
                val avatarUrl = avatarUrlInput.text?.toString()?.trim().takeIf { !it.isNullOrBlank() }
                if (name.isEmpty()) {
                    Snackbar.make(profilePage, "Введите имя", Snackbar.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                Thread {
                    val r = AuthApi.updateProfile(sessionManager.token, name, avatarUrl)
                    runOnUiThread {
                        when (r) {
                            is AuthApi.ApiResult.Success -> {
                                sessionManager.userName = r.data.user.name
                                sessionManager.userAvatarUrl = r.data.user.avatar_url
                                updateProfileUI()
                                Snackbar.make(profilePage, "Профиль обновлён", Snackbar.LENGTH_SHORT).show()
                            }
                            is AuthApi.ApiResult.Error -> Snackbar.make(profilePage, r.message, Snackbar.LENGTH_SHORT).show()
                        }
                    }
                }.start()
            }
            .setNegativeButton("Отмена", null)
            .create()
        dialog.show()
    }

    private fun setupTopBarMenu() {
        topAppBar.setOnMenuItemClickListener { item: MenuItem ->
            when (item.itemId) {
                R.id.action_guide -> {
                    showPageById(R.id.action_guide)
                    true
                }
                R.id.action_profile -> {
                    showPageById(R.id.action_profile)
                    true
                }
                R.id.action_settings -> {
                    showPageById(R.id.action_settings)
                    true
                }
                else -> false
            }
        }
    }

    private fun setupBuildPageTabs() {
        val tabs = buildPage.findViewById<TabLayout>(R.id.buildMainTabs)
        val buildListInclude = buildPage.findViewById<View>(R.id.buildListInclude)
        val buildDetailInclude = buildPage.findViewById<View>(R.id.buildDetailInclude)
        val componentPickerInclude = buildPage.findViewById<View>(R.id.componentPickerInclude)
        val cartInclude = buildPage.findViewById<View>(R.id.buildCartInclude)

        if (tabs.tabCount == 0) {
            tabs.addTab(tabs.newTab().setText("Сборка"), true)
            tabs.addTab(tabs.newTab().setText("Корзина"), false)
        }

        fun showBuildArea() {
            cartInclude.visibility = View.GONE
            // Если внутри сборки уже открыт детальный экран или пикер — не ломаем состояние
            if (componentPickerInclude.visibility == View.VISIBLE) return
            if (buildDetailInclude.visibility == View.VISIBLE) return
            buildListInclude.visibility = View.VISIBLE
        }

        fun showCartArea() {
            buildListInclude.visibility = View.GONE
            buildDetailInclude.visibility = View.GONE
            componentPickerInclude.visibility = View.GONE
            cartInclude.visibility = View.VISIBLE
            loadCartCallback?.invoke()
        }

        // Дефолт
        buildDetailInclude.visibility = View.GONE
        cartInclude.visibility = View.GONE
        buildListInclude.visibility = View.VISIBLE

        tabs.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab?) {
                when (tab?.position ?: 0) {
                    1 -> showCartArea()
                    else -> showBuildArea()
                }
            }

            override fun onTabUnselected(tab: TabLayout.Tab?) {}
            override fun onTabReselected(tab: TabLayout.Tab?) {
                onTabSelected(tab)
            }
        })
    }

    private fun shareBuildText(detail: BuildsApi.BuildDetail) {
        val lines = mutableListOf<String>()
        lines.add("Сборка «${detail.name}» (DipProg)")
        detail.components?.forEach { c ->
            lines.add("• ${c.category_name ?: ""} ${c.name} ×${c.quantity} — ${c.price ?: "—"} ₽")
        }
        detail.total_price?.let { lines.add("Итого: ${priceStr(it)}") }
        val text = lines.joinToString("\n")
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
            putExtra(Intent.EXTRA_SUBJECT, detail.name)
        }
        startActivity(Intent.createChooser(send, getString(R.string.share_build_chooser)))
    }

    private fun formatOrderDateForDialog(value: String?): String {
        if (value.isNullOrBlank()) return "—"
        return try {
            val parser = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
            val fallback = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
            val out = SimpleDateFormat("dd.MM.yyyy HH:mm", Locale("ru", "RU"))
            val d = parser.parse(value) ?: fallback.parse(value)
            if (d != null) out.format(d) else value.take(16)
        } catch (_: Exception) {
            value.take(16)
        }
    }

    private fun orderStageShortLabel(order: BuildsApi.Order, isAssembler: Boolean): String {
        val st = order.status?.lowercase(Locale.ROOT) ?: ""
        return when {
            st == "received" -> getString(R.string.order_detail_stage_received)
            st == "sent" ->
                if (isAssembler) getString(R.string.order_detail_stage_sent_assembler)
                else getString(R.string.order_detail_stage_sent_customer)
            st == "new" ->
                if (isAssembler) getString(R.string.order_detail_stage_new_assembler)
                else getString(R.string.order_detail_stage_new_customer)
            else -> order.status ?: "—"
        }
    }

    private fun showOrderDetailDialog(order: BuildsApi.Order) {
        val density = resources.displayMetrics.density
        val pad = (20 * density).toInt()
        val scroll = ScrollView(this)

        val accent = MaterialColors.getColor(this, com.google.android.material.R.attr.colorPrimary, 0)
        val valueColor = MaterialColors.getColor(this, com.google.android.material.R.attr.colorOnSurface, 0)
        val mutedColor = MaterialColors.getColor(this, com.google.android.material.R.attr.colorOnSurfaceVariant, 0)

        val ssb = SpannableStringBuilder()

        fun appendSectionTitle(title: String) {
            if (ssb.isNotEmpty()) ssb.append('\n')
            val start = ssb.length
            ssb.append(title).append('\n')
            val end = start + title.length
            ssb.setSpan(StyleSpan(Typeface.BOLD), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            ssb.setSpan(ForegroundColorSpan(accent), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }

        fun appendValueLine(text: String) {
            val start = ssb.length
            ssb.append(text).append('\n')
            ssb.setSpan(ForegroundColorSpan(valueColor), start, ssb.length - 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }

        fun appendMutedLine(text: String) {
            val start = ssb.length
            ssb.append(text).append('\n')
            ssb.setSpan(ForegroundColorSpan(mutedColor), start, ssb.length - 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }

        fun appendLabeledLine(label: String, value: String) {
            val lineStart = ssb.length
            val labelWithColon = "$label: "
            ssb.append(labelWithColon)
            val afterLabel = ssb.length
            ssb.append(value).append('\n')
            ssb.setSpan(StyleSpan(Typeface.BOLD), lineStart, afterLabel, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            ssb.setSpan(ForegroundColorSpan(accent), lineStart, afterLabel, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            ssb.setSpan(ForegroundColorSpan(valueColor), afterLabel, ssb.length - 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }

        appendSectionTitle(getString(R.string.order_detail_section_recipient))
        appendValueLine(order.customer_name)
        appendValueLine(order.customer_phone)
        appendValueLine(order.customer_email)

        appendSectionTitle(getString(R.string.order_detail_section_address))
        appendValueLine(order.shipping_address)

        if (!order.comment.isNullOrBlank()) {
            appendSectionTitle(getString(R.string.order_detail_section_comment))
            appendValueLine(order.comment.trim())
        }

        appendSectionTitle(getString(R.string.order_detail_section_items))
        val items = order.items_json
        if (items.isNullOrEmpty()) {
            appendMutedLine(getString(R.string.order_detail_items_empty))
        } else {
            for (it in items) {
                val unit = when (val p = it.price) {
                    is Number -> p.toDouble()
                    is String -> p.replace(",", ".").toDoubleOrNull() ?: 0.0
                    else -> p?.toString()?.replace(",", ".")?.toDoubleOrNull() ?: 0.0
                }
                val lineTotal = unit * it.quantity
                val line = if (it.quantity <= 1) {
                    getString(R.string.order_detail_item_qty_one, it.name, priceStr(lineTotal))
                } else {
                    getString(
                        R.string.order_detail_item_qty_many,
                        it.name,
                        it.quantity,
                        priceStr(unit),
                        priceStr(lineTotal)
                    )
                }
                appendMutedLine(line)
            }
        }

        ssb.append('\n')
        appendLabeledLine(getString(R.string.order_detail_lbl_total), priceStr(order.total_rub))

        appendSectionTitle(getString(R.string.order_detail_section_timeline))
        appendLabeledLine(
            getString(R.string.order_detail_lbl_stage),
            orderStageShortLabel(order, sessionManager.isAssembler)
        )
        appendLabeledLine(getString(R.string.order_detail_lbl_created), formatOrderDateForDialog(order.created_at))
        if (!order.completed_at.isNullOrBlank()) {
            appendLabeledLine(getString(R.string.order_detail_lbl_sent), formatOrderDateForDialog(order.completed_at))
        }
        if (!order.received_at.isNullOrBlank()) {
            appendLabeledLine(getString(R.string.order_detail_lbl_received), formatOrderDateForDialog(order.received_at))
        }
        if (sessionManager.isAssembler) {
            ssb.append('\n')
            appendLabeledLine(getString(R.string.order_detail_lbl_client_id), order.user_id.toString())
        }

        val messageTv = TextView(this).apply {
            text = ssb
            textSize = 14f
            setPadding(pad, pad / 2, pad, pad)
            setTextColor(mutedColor)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                breakStrategy = Layout.BREAK_STRATEGY_SIMPLE
                hyphenationFrequency = Layout.HYPHENATION_FREQUENCY_NONE
            }
        }
        scroll.addView(messageTv)
        MaterialAlertDialogBuilder(this)
            .setTitle(getString(R.string.order_detail_title, order.id))
            .setView(scroll)
            .setPositiveButton(android.R.string.ok, null)
            .show()
    }

    private fun showComponentDetailDialog(detail: BuildsApi.ComponentDetail) {
        val lines = mutableListOf<String>()
        detail.category_name?.let { lines.add("Категория: $it") }
        detail.price?.let { lines.add("Цена: ${priceStr(it)}") }
        detail.description?.takeIf { it.isNotBlank() }?.let { lines.add("\n$it") }
        val specBlock = ComponentSpecFormatter.formatBlock(detail.specs)
        if (specBlock.isNotBlank()) {
            lines.add("\nХарактеристики:\n$specBlock")
        }
        val message = lines.joinToString("\n").ifBlank { "Нет дополнительных данных." }
        val density = resources.displayMetrics.density
        val pad = (20 * density).toInt()
        val scroll = ScrollView(this)
        val messageTv = TextView(this).apply {
            text = message
            textSize = 14f
            setPadding(pad, pad / 2, pad, pad)
            setTextColor(resources.getColor(R.color.text_secondary, theme))
        }
        scroll.addView(messageTv)
        MaterialAlertDialogBuilder(this)
            .setTitle(detail.name)
            .setView(scroll)
            .setPositiveButton(android.R.string.ok, null)
            .show()
    }

    private fun setupGuidePage() {
        val rv = guidePage.findViewById<RecyclerView>(R.id.guideRecycler)
        val empty = guidePage.findViewById<TextView>(R.id.guideEmpty)
        val search = guidePage.findViewById<TextInputEditText>(R.id.guideSearchInput)
        rv.layoutManager = LinearLayoutManager(this)
        val adapter = GuideAdapter(BeginnerGuide.sections) { count ->
            empty.visibility = if (count == 0) View.VISIBLE else View.GONE
        }
        rv.adapter = adapter
        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                adapter.setFilter(s?.toString().orEmpty())
            }
        })
    }

    private fun setupOrdersPage() {
        val swipe = ordersPage.findViewById<SwipeRefreshLayout>(R.id.ordersSwipeRefresh)
        val recycler = ordersPage.findViewById<RecyclerView>(R.id.ordersRecycler)
        val emptyState = ordersPage.findViewById<View>(R.id.ordersEmptyState)
        val empty = ordersPage.findViewById<TextView>(R.id.ordersEmpty)
        val emptyHint = ordersPage.findViewById<TextView>(R.id.ordersEmptyHint)
        val emptyCta = ordersPage.findViewById<MaterialButton>(R.id.ordersEmptyCta)
        val subtitle = ordersPage.findViewById<TextView>(R.id.ordersSubtitle)
        swipe.setColorSchemeResources(R.color.md_primary, R.color.md_secondary)
        swipe.setOnRefreshListener { refreshOrdersCallback?.invoke() }
        recycler.layoutManager = LinearLayoutManager(this)
        val adapter = OrdersAdapter(
            emptyList(),
            { sessionManager.isAssembler },
            { order ->
                launchIo(
                    work = { BuildsApi.completeOrder(sessionManager.token, order.id) },
                    onMain = { r ->
                        when (r) {
                            is BuildsApi.ApiResult.Success -> {
                                anchoredSnackbar(getString(R.string.order_snackbar_sent, order.id))
                                refreshOrdersCallback?.invoke()
                            }
                            is BuildsApi.ApiResult.Error -> anchoredSnackbar(r.message)
                        }
                    },
                )
            },
            { order ->
                launchIo(
                    work = { BuildsApi.confirmOrderReceipt(sessionManager.token, order.id) },
                    onMain = { r ->
                        when (r) {
                            is BuildsApi.ApiResult.Success -> {
                                anchoredSnackbar(getString(R.string.order_snackbar_received, order.id))
                                refreshOrdersCallback?.invoke()
                            }
                            is BuildsApi.ApiResult.Error -> anchoredSnackbar(r.message)
                        }
                    },
                )
            },
            { order -> showOrderDetailDialog(order) },
        )
        recycler.adapter = adapter
        refreshOrdersCallback = ordersRefresh@{
            fun applyGuestEmpty() {
                swipe.isRefreshing = false
                recycler.visibility = View.INVISIBLE
                emptyState.visibility = View.VISIBLE
                empty.setText(R.string.orders_empty_customer)
                emptyHint.visibility = View.VISIBLE
                emptyHint.setText(R.string.orders_empty_hint_guest)
                emptyCta.visibility = View.VISIBLE
                emptyCta.setText(R.string.orders_empty_cta_login)
                emptyCta.setOnClickListener { showAuthOverlay(registerMode = false) }
            }
            if (!sessionManager.isLoggedIn) {
                applyGuestEmpty()
                return@ordersRefresh
            }
            subtitle.text = if (sessionManager.isAssembler) {
                getString(R.string.orders_subtitle_assembler)
            } else {
                getString(R.string.orders_subtitle_customer)
            }
            emptyCta.setOnClickListener { showPageById(R.id.navigation_build) }
            launchIo(
                work = {
                    if (sessionManager.isAssembler) {
                        BuildsApi.assemblerOrders(sessionManager.token)
                    } else {
                        BuildsApi.myOrders(sessionManager.token)
                    }
                },
                onMain = { r ->
                    swipe.isRefreshing = false
                    when (r) {
                        is BuildsApi.ApiResult.Success -> {
                            adapter.setData(r.data)
                            if (r.data.isEmpty()) {
                                recycler.visibility = View.INVISIBLE
                                emptyState.visibility = View.VISIBLE
                                val assembler = sessionManager.isAssembler
                                empty.text = if (assembler) {
                                    getString(R.string.orders_empty_assembler)
                                } else {
                                    getString(R.string.orders_empty_customer)
                                }
                                emptyHint.visibility = View.VISIBLE
                                emptyHint.text = if (assembler) {
                                    getString(R.string.orders_empty_hint_assembler)
                                } else {
                                    getString(R.string.orders_empty_hint_customer)
                                }
                                if (assembler) {
                                    emptyCta.visibility = View.GONE
                                } else {
                                    emptyCta.visibility = View.VISIBLE
                                    emptyCta.setText(R.string.orders_empty_cta_build)
                                }
                            } else {
                                emptyState.visibility = View.GONE
                                recycler.visibility = View.VISIBLE
                            }
                        }
                        is BuildsApi.ApiResult.Error -> {
                            recycler.visibility = View.INVISIBLE
                            emptyState.visibility = View.VISIBLE
                            empty.text = r.message
                            emptyHint.visibility = View.GONE
                            emptyCta.visibility = View.GONE
                        }
                    }
                },
            )
        }
    }

    private fun anchoredSnackbar(message: CharSequence, length: Int = Snackbar.LENGTH_SHORT) {
        Snackbar.make(findViewById(R.id.main), message, length)
            .setAnchorView(bottomNavigationView)
            .show()
    }

    private fun setupHomePage() {
        // Корень page_home — SwipeRefreshLayout; id homeSwipeRefresh в XML заменяется на homePage из <include android:id="@+id/homePage" />.
        val homeSwipeRefresh = homePage as SwipeRefreshLayout
        homeSwipeRefresh.setColorSchemeResources(R.color.md_primary, R.color.md_secondary)
        homeSwipeRefresh.setOnRefreshListener { refreshHomeBuildsCard?.invoke() }
        val homeMyBuildsCard = homePage.findViewById<View>(R.id.homeMyBuildsCard)
        val homeMyBuildsSubtitle = homePage.findViewById<TextView>(R.id.homeMyBuildsSubtitle)
        refreshHomeBuildsCard = {
            if (sessionManager.token.isNullOrBlank()) {
                homeMyBuildsCard.visibility = View.VISIBLE
                homeMyBuildsSubtitle.text = getString(R.string.home_my_builds_guest)
                homeSwipeRefresh.isRefreshing = false
            } else {
                launchIo(
                    work = { BuildsApi.builds(sessionManager.token) },
                    onMain = { r ->
                        homeSwipeRefresh.isRefreshing = false
                        homeMyBuildsCard.visibility = View.VISIBLE
                        when (r) {
                            is BuildsApi.ApiResult.Success -> {
                                val n = r.data.size
                                homeMyBuildsSubtitle.text = if (n == 0) {
                                    getString(R.string.home_my_builds_empty)
                                } else {
                                    getString(R.string.home_my_builds_summary, n)
                                }
                            }
                            else -> homeMyBuildsSubtitle.text = getString(R.string.home_my_builds_empty)
                        }
                    },
                )
            }
        }
        homeMyBuildsCard.setOnClickListener { showPageById(R.id.navigation_build) }

        homePage.findViewById<View>(R.id.homeGuideCard).setOnClickListener {
            showPageById(R.id.action_guide)
        }

        val searchInput = homePage.findViewById<TextInputEditText>(R.id.homeSearchInput)
        searchInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                val query = searchInput.text?.toString()?.trim()
                pendingPickerSearchQuery = query?.takeIf { it.isNotEmpty() }
                openBuildPageWithCategory?.invoke(null)
                if (!query.isNullOrEmpty()) {
                    anchoredSnackbar(getString(R.string.snackbar_catalog_search, query))
                }
                true
            } else false
        }
        homePage.findViewById<View>(R.id.homeRecommendedGaming).setOnClickListener {
            createPresetBuildAndOpen?.invoke("Gaming сборка", "gaming") ?: showPageById(R.id.navigation_build)
        }
        homePage.findViewById<View>(R.id.homeRecommendedWorkstation).setOnClickListener {
            createPresetBuildAndOpen?.invoke("Рабочая станция", "workstation") ?: showPageById(R.id.navigation_build)
        }
    }

    private fun setupBottomNavigation() {
        bottomNavigationView.setOnItemSelectedListener { menuItem ->
            // Не вызывать showPageById повторно при программной установке selectedItemId (иначе рекурсия и падение)
            if (currentPageId == menuItem.itemId) return@setOnItemSelectedListener true
            bottomNavigationView.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
            when (menuItem.itemId) {
                R.id.navigation_home -> {
                    showPageById(R.id.navigation_home)
                    true
                }
                R.id.navigation_build -> {
                    showPageById(R.id.navigation_build)
                    true
                }
                R.id.navigation_ai_chat -> {
                    showPageById(R.id.navigation_ai_chat)
                    true
                }
                R.id.navigation_orders -> {
                    showPageById(R.id.navigation_orders)
                    true
                }
                else -> false
            }
        }
    }

    private fun showPage(pageToShow: View) {
        homePage.visibility = View.GONE
        settingsPage.visibility = View.GONE
        buildPage.visibility = View.GONE
        aiChatPage.visibility = View.GONE
        ordersPage.visibility = View.GONE
        profilePage.visibility = View.GONE
        guidePage.visibility = View.GONE
        pageToShow.visibility = View.VISIBLE
    }

    // --- Методы для работы с настройками ---

    private fun loadSettings() {
        val sharedPrefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = sharedPrefs.getInt(THEME_KEY, AppCompatDelegate.MODE_NIGHT_NO)
        val selectedTheme = when (raw) {
            AppCompatDelegate.MODE_NIGHT_NO, AppCompatDelegate.MODE_NIGHT_YES -> raw
            else -> AppCompatDelegate.MODE_NIGHT_NO
        }
        if (raw != selectedTheme) {
            sharedPrefs.edit().putInt(THEME_KEY, selectedTheme).apply()
        }

        // Применить сохраненную тему ДО setContentView
        AppCompatDelegate.setDefaultNightMode(selectedTheme)
        Log.d("Settings", "Тема загружена и применена: $selectedTheme")
    }

    private fun saveTheme(themeMode: Int) {
        with(getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()) {
            putInt(THEME_KEY, themeMode)
            apply()
        }
        // Применить тему немедленно
        AppCompatDelegate.setDefaultNightMode(themeMode)
        Log.d("Settings", "Тема сохранена и применена: $themeMode")
    }

    private fun saveNotifications(enabled: Boolean) {
        with(getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()) {
            putBoolean(NOTIFICATIONS_KEY, enabled)
            apply()
        }
        Log.d("Settings", "Уведомления сохранены: $enabled")
    }

    private fun setupSettingsListeners() {
        themeToggleGroup.addOnButtonCheckedListener { group, checkedId, isChecked ->
            if (isChecked) {
                when (checkedId) {
                    R.id.lightThemeButton -> {
                        saveTheme(AppCompatDelegate.MODE_NIGHT_NO)
                        Log.d("Settings", "Тема изменена на светлую")
                    }
                    R.id.darkThemeButton -> {
                        saveTheme(AppCompatDelegate.MODE_NIGHT_YES)
                        Log.d("Settings", "Тема изменена на темную")
                    }
                }
            }
        }

        notificationsSwitch.setOnCheckedChangeListener { _, isChecked ->
            saveNotifications(isChecked)
            Log.d("Settings", "Уведомления ${if (isChecked) "включены" else "отключены"}")
        }
    }

    // Этот метод вызывается каждый раз при открытии страницы настроек
    // Он обновляет UI в соответствии с сохраненными настройками
    private fun updateSettingsUI() {
        val sharedPrefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val selectedTheme = sharedPrefs.getInt(THEME_KEY, AppCompatDelegate.MODE_NIGHT_NO)
        val notificationsEnabled = sharedPrefs.getBoolean(NOTIFICATIONS_KEY, true)

        // Обновить ToggleGroup в соответствии с сохраненной темой
        when (selectedTheme) {
            AppCompatDelegate.MODE_NIGHT_NO -> {
                themeToggleGroup.check(R.id.lightThemeButton)
                Log.d("Settings", "UI: Установлена светлая тема")
            }
            AppCompatDelegate.MODE_NIGHT_YES -> {
                themeToggleGroup.check(R.id.darkThemeButton)
                Log.d("Settings", "UI: Установлена темная тема")
            }
            // Можно добавить другие режимы, если используете AUTO и т.д.
            else -> {
                // selectionRequired=true: нельзя clearChecked(); сбрасываем в светлую и правим prefs
                saveTheme(AppCompatDelegate.MODE_NIGHT_NO)
                themeToggleGroup.check(R.id.lightThemeButton)
                Log.d("Settings", "UI: Неизвестный режим темы — сброшено на светлую")
            }
        }

        // Обновить Switch в соответствии с сохраненным состоянием уведомлений
        notificationsSwitch.isChecked = notificationsEnabled
        Log.d("Settings", "UI: Переключатель уведомлений обновлен на ${if (notificationsEnabled) "вкл" else "выкл"}")
    }

    // --- Методы для работы с чатом ---

    private fun setupChatListeners() {
        // Отправка сообщения по кнопке
        sendMessageButton.setOnClickListener {
            sendMessage()
        }

        // Отправка сообщения по нажатию Enter (опционально)
        messageInputEditText.setOnEditorActionListener { v, actionId, event ->
            if (event != null && (event.keyCode == android.view.KeyEvent.KEYCODE_ENTER || event.action == android.view.KeyEvent.ACTION_DOWN && event.keyCode == android.view.KeyEvent.KEYCODE_ENTER)) {
                sendMessage()
                return@setOnEditorActionListener true
            }
            false // Вернуть false, если событие не обработано
        }

        // Прикрепление своей сборки для вопросов ИИ
        attachBuildButton.setOnClickListener { showAttachBuildDialog() }
    }

    /** Текст прикреплённой сборки для контекста ИИ (название + список компонентов). null = не прикреплено. */
    private var attachedBuildSummary: String? = null

    private fun showAttachBuildDialog() {
        if (sessionManager.token.isNullOrBlank()) {
            Snackbar.make(aiChatPage, "Войдите в аккаунт, чтобы прикрепить сборку", Snackbar.LENGTH_SHORT).show()
            return
        }
        if (attachedBuildSummary != null) {
            MaterialAlertDialogBuilder(this)
                .setTitle("Открепить сборку?")
                .setMessage("Сейчас прикреплена сборка. Открепить её или выбрать другую?")
                .setPositiveButton("Открепить") { _, _ ->
                    attachedBuildSummary = null
                    Snackbar.make(aiChatPage, "Сборка откреплена", Snackbar.LENGTH_SHORT).show()
                }
                .setNeutralButton("Выбрать другую") { _, _ -> loadBuildsAndShowPicker() }
                .setNegativeButton("Отмена", null)
                .show()
            return
        }
        loadBuildsAndShowPicker()
    }

    private fun loadBuildsAndShowPicker() {
        Thread {
            val res = BuildsApi.builds(sessionManager.token)
            runOnUiThread {
                when (res) {
                    is BuildsApi.ApiResult.Success -> {
                        val list = res.data
                        if (list.isEmpty()) {
                            Snackbar.make(aiChatPage, "У вас пока нет сборок. Создайте сборку в разделе «Сборка»", Snackbar.LENGTH_LONG).show()
                            return@runOnUiThread
                        }
                        val names = list.map { it.name }
                        MaterialAlertDialogBuilder(this)
                            .setTitle("Прикрепить сборку к запросу")
                            .setItems(names.toTypedArray()) { _, which ->
                                val build = list[which]
                                loadBuildDetailAndAttach(build.id)
                            }
                            .setNegativeButton("Отмена", null)
                            .show()
                    }
                    is BuildsApi.ApiResult.Error -> Snackbar.make(aiChatPage, res.message, Snackbar.LENGTH_SHORT).show()
                }
            }
        }.start()
    }

    private fun loadBuildDetailAndAttach(buildId: Int) {
        Thread {
            val res = BuildsApi.buildDetail(sessionManager.token, buildId)
            runOnUiThread {
                when (res) {
                    is BuildsApi.ApiResult.Success -> {
                        val d = res.data
                        val lines = mutableListOf<String>()
                        lines.add("Сборка «${d.name}»")
                        d.components?.forEach { c ->
                            lines.add("  ${c.category_name ?: ""}: ${c.name} x${c.quantity} — ${c.price ?: "—"} руб.")
                        }
                        d.total_price?.let { lines.add("Итого: $it руб.") }
                        attachedBuildSummary = lines.joinToString("\n")
                        addMessageToContainer("Вы прикрепили сборку «${d.name}». Задайте вопрос — ИИ ответит по этой сборке.", isUser = true)
                        Snackbar.make(aiChatPage, "Сборка прикреплена. Задайте вопрос", Snackbar.LENGTH_SHORT).show()
                    }
                    is BuildsApi.ApiResult.Error -> Snackbar.make(aiChatPage, res.message, Snackbar.LENGTH_SHORT).show()
                }
            }
        }.start()
    }

    private fun sendMessage() {
        val messageText = messageInputEditText.text.toString().trim()
        if (messageText.isNotEmpty()) {
            addMessageToContainer(messageText, isUser = true)
            apiChatHistory.add(BuildsApi.ChatHistoryMessage("user", messageText))
            messageInputEditText.setText("")
            requestBuildSuggestions(messageText, attachedBuildSummary)
        }
    }

    private val messageSpacingPx: Int
        get() = (20 * resources.displayMetrics.density).toInt()

    /** Добавляет только view сообщения (для восстановления истории). */
    private fun addMessageBubble(text: String, isUser: Boolean) {
        val maxBubble = (resources.displayMetrics.widthPixels * 0.8f).toInt()
        val messageTextView = TextView(this).apply {
            this.text = text
            textSize = 15.5f
            maxWidth = maxBubble
            setLineSpacing(2f, 1.08f)
            setPadding(20, 14, 20, 14)
            if (isUser) {
                setBackgroundResource(R.drawable.user_message_background)
                setTextColor(resources.getColor(R.color.text_on_user_message_bg, theme))
            } else {
                setBackgroundResource(R.drawable.ai_message_background)
                setTextColor(resources.getColor(R.color.text_on_ai_message_bg, theme))
            }
        }
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        val spacer = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, 0, 1f)
        }
        val bubbleLp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        if (isUser) {
            row.addView(spacer)
            row.addView(messageTextView, bubbleLp)
        } else {
            row.addView(messageTextView, bubbleLp)
            row.addView(spacer)
        }
        val params = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = messageSpacingPx
        }
        messagesContainer.addView(row, params)
    }

    private fun addMessageToContainer(text: String, isUser: Boolean) {
        chatHistory.add(Pair(text, isUser))
        addMessageBubble(text, isUser)
        scrollToBottomOfMessages()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putInt(KEY_CURRENT_PAGE, currentPageId)
        val texts = ArrayList(chatHistory.map { it.first })
        val isUser = IntArray(chatHistory.size) { if (chatHistory[it].second) 1 else 0 }
        outState.putStringArrayList(BUNDLE_CHAT_TEXTS, texts)
        outState.putIntArray(BUNDLE_CHAT_IS_USER, isUser)
        if (lastSuggestions.isNotEmpty()) {
            outState.putString(BUNDLE_CHAT_SUGGESTIONS, chatGson.toJson(lastSuggestions))
        }
        if (apiChatHistory.isNotEmpty()) {
            outState.putString(BUNDLE_API_HISTORY, chatGson.toJson(apiChatHistory))
        }
    }

    private fun restoreChatFromState(savedInstanceState: Bundle?) {
        if (savedInstanceState == null) return
        val texts = savedInstanceState.getStringArrayList(BUNDLE_CHAT_TEXTS) ?: return
        val isUserArr = savedInstanceState.getIntArray(BUNDLE_CHAT_IS_USER) ?: return
        if (texts.size != isUserArr.size) return
        chatHistory.clear()
        for (i in texts.indices) {
            val text = texts[i]
            val isUser = isUserArr[i] != 0
            chatHistory.add(Pair(text, isUser))
            addMessageBubble(text, isUser)
        }
        savedInstanceState.getString(BUNDLE_CHAT_SUGGESTIONS)?.let { json ->
            val type = object : TypeToken<List<BuildsApi.BuildSuggestion>>() {}.type
            @Suppress("UNCHECKED_CAST")
            val list = chatGson.fromJson<List<BuildsApi.BuildSuggestion>>(json, type) ?: emptyList()
            if (list.isNotEmpty()) {
                lastSuggestions = list
                addSuggestionCards(list)
            }
        }
        savedInstanceState.getString(BUNDLE_API_HISTORY)?.let { json ->
            val type = object : TypeToken<List<BuildsApi.ChatHistoryMessage>>() {}.type
            @Suppress("UNCHECKED_CAST")
            val list = chatGson.fromJson<List<BuildsApi.ChatHistoryMessage>>(json, type) ?: emptyList()
            apiChatHistory.clear()
            apiChatHistory.addAll(list)
        }
        if (chatHistory.isNotEmpty()) scrollToBottomOfMessages()
    }

    private fun startTypingAnimation(tv: TextView) {
        typingRunnable?.let { typingHandler.removeCallbacks(it) }
        var dots = 0
        typingRunnable = object : Runnable {
            override fun run() {
                dots = (dots + 1) % 4
                tv.text = "Думаю" + ".".repeat(dots)
                typingHandler.postDelayed(this, 420)
            }
        }
        typingHandler.post(typingRunnable!!)
    }

    private fun stopTypingAnimation() {
        typingRunnable?.let { typingHandler.removeCallbacks(it) }
        typingRunnable = null
    }

    private fun requestBuildSuggestions(userMessage: String, buildSummary: String? = null) {
        // Создаём пузырь "Думаю…" с анимацией
        val loadingWrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 16, 24, 16)
        }
        val loadingText = TextView(this).apply {
            text = "Думаю"
            textSize = 16f
            setBackgroundResource(R.drawable.ai_message_background)
            setTextColor(resources.getColor(R.color.text_on_ai_message_bg, theme))
        }
        loadingWrap.addView(loadingText)
        val loadingParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = messageSpacingPx
        }
        messagesContainer.addView(loadingWrap, loadingParams)
        startTypingAnimation(loadingText)
        scrollToBottomOfMessages()

        // Передаём историю (последние 8 обменов = 16 сообщений)
        val historySnapshot = apiChatHistory.takeLast(16).toList()

        Thread {
            val result = BuildsApi.buildSuggestions(userMessage, buildSummary, historySnapshot)
            runOnUiThread {
                stopTypingAnimation()
                messagesContainer.removeView(loadingWrap)
                when (result) {
                    is BuildsApi.ApiResult.Success -> {
                        val data = result.data
                        val hasText = !data.text.isNullOrBlank()
                        val hasSuggestions = !data.suggestions.isNullOrEmpty()
                        if (hasText) {
                            val txt = data.text!!.trim()
                            addMessageToContainer(txt, isUser = false)
                            // Добавляем ответ ИИ в историю контекста
                            apiChatHistory.add(BuildsApi.ChatHistoryMessage("assistant", txt.take(500)))
                            // Обрезаем историю до разумного размера
                            if (apiChatHistory.size > 20) {
                                val excess = apiChatHistory.size - 20
                                repeat(excess) { apiChatHistory.removeAt(0) }
                            }
                        }
                        if (hasSuggestions) addSuggestionCards(data.suggestions!!)
                        if (!hasText && !hasSuggestions) addMessageToContainer("Уточните запрос: например, «Игровая сборка до 100к» или «RTX 5070 монтаж видео».", isUser = false)
                    }
                    is BuildsApi.ApiResult.Error -> {
                        addMessageToContainer("Ошибка связи: ${result.message}", isUser = false)
                    }
                }
                scrollToBottomOfMessages()
            }
        }.start()
    }

    private fun addSuggestionCards(suggestions: List<BuildsApi.BuildSuggestion>) {
        lastSuggestions = suggestions
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 8, 0, 8)
        }
        val wrapParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = messageSpacingPx
        }
        for (s in suggestions) {
            val card = LayoutInflater.from(this).inflate(R.layout.item_ai_suggestion, wrap, false)
            card.findViewById<TextView>(R.id.suggestionTitle).text = s.name
            val descTv = card.findViewById<TextView>(R.id.suggestionDescription)
            val desc = s.description?.trim().orEmpty()
            if (desc.isNotEmpty()) {
                descTv.text = desc
                descTv.visibility = View.VISIBLE
            } else {
                descTv.visibility = View.GONE
            }

            val prosBlock = card.findViewById<View>(R.id.suggestionProsBlock)
            val consBlock = card.findViewById<View>(R.id.suggestionConsBlock)
            val prosView = card.findViewById<TextView>(R.id.suggestionPros)
            val consView = card.findViewById<TextView>(R.id.suggestionCons)

            if (!s.pros.isNullOrEmpty()) {
                prosView.text = s.pros.joinToString("\n") { "• $it" }
                prosBlock.visibility = View.VISIBLE
            } else prosBlock.visibility = View.GONE

            if (!s.cons.isNullOrEmpty()) {
                consView.text = s.cons.joinToString("\n") { "• $it" }
                consBlock.visibility = View.VISIBLE
            } else consBlock.visibility = View.GONE

            val addBtn = card.findViewById<MaterialButton>(R.id.suggestionAddButton)
            val detailsBtn = card.findViewById<MaterialButton>(R.id.suggestionDetailsButton)

            if (!s.componentIds.isNullOrEmpty()) {
                addBtn.visibility = View.VISIBLE
                detailsBtn.visibility = View.VISIBLE
                addBtn.text = getString(R.string.ai_suggestion_save_build_with_count, s.componentIds.size)
                addBtn.setOnClickListener { onAddSuggestionToBuilds(s) }
                detailsBtn.setOnClickListener { showSuggestionDetails(s) }
            } else {
                addBtn.visibility = View.GONE
                detailsBtn.visibility = View.GONE
            }
            wrap.addView(card)
        }
        messagesContainer.addView(wrap, wrapParams)
    }

    /** Иконка категории для карточки компонента в диалоге ИИ. */
    private fun categoryGlyphForSlug(slug: String?): String {
        return when (slug?.lowercase()) {
            "processors" -> "⚙"
            "motherboard" -> "🧩"
            "gpu" -> "🎮"
            "ram" -> "📀"
            "storage" -> "💾"
            "psu" -> "⚡"
            "case" -> "📦"
            else -> "🖥"
        }
    }

    /** Парсит «Бюджет до N» из текста описания подборки. */
    private fun parseBudgetHintFromDescription(desc: String?): Int? {
        if (desc.isNullOrBlank()) return null
        val m = Regex("""Бюджет\s+до\s+([\d\s\u00a0]+)""", RegexOption.IGNORE_CASE).find(desc)
        return m?.groupValues?.get(1)?.replace(" ", "")?.replace("\u00a0", "")?.toIntOrNull()
    }

    /** Короткая подпись под итогом, без дублирования списка компонентов. */
    private fun extractSubtitleFromSuggestionDescription(desc: String?): String? {
        val d = desc?.trim() ?: return null
        if (d.length > 140) return null
        if (Regex("""Итого|Бюджет|Совместимая сборка:""", RegexOption.IGNORE_CASE).containsMatchIn(d)) return null
        return d.takeIf { it.length >= 8 }
    }

    /** Показывает детальный состав сборки из предложений ИИ (карточки, итог, типографика). */
    private fun showSuggestionDetails(s: BuildsApi.BuildSuggestion) {
        val ids = s.componentIds ?: return
        if (ids.isEmpty()) return

        Thread {
            val inflater = LayoutInflater.from(this)
            val content = inflater.inflate(R.layout.dialog_ai_build_detail, null, false)
            val container = content.findViewById<LinearLayout>(R.id.suggestionComponentsContainer)
            val totalTv = content.findViewById<TextView>(R.id.suggestionDetailTotal)
            val budgetHint = content.findViewById<TextView>(R.id.suggestionDetailBudgetHint)
            val subtitleTv = content.findViewById<TextView>(R.id.suggestionDetailSubtitle)

            var sumRub = 0.0
            for (id in ids) {
                when (val r = BuildsApi.componentDetail(null, id)) {
                    is BuildsApi.ApiResult.Success -> {
                        val d = r.data
                        val row = inflater.inflate(R.layout.item_suggestion_component_row, container, false)
                        row.findViewById<TextView>(R.id.componentGlyph).text = categoryGlyphForSlug(d.category_slug)
                        row.findViewById<TextView>(R.id.componentCategory).text =
                            (d.category_name ?: "Компонент").uppercase()
                        row.findViewById<TextView>(R.id.componentName).text = d.name
                        val p = d.price?.toString()?.toDoubleOrNull()
                        if (p != null) sumRub += p
                        row.findViewById<TextView>(R.id.componentPrice).text = priceStr(d.price)
                        container.addView(row)
                    }
                    else -> {
                        val row = inflater.inflate(R.layout.item_suggestion_component_row, container, false)
                        row.findViewById<TextView>(R.id.componentGlyph).text = "❔"
                        row.findViewById<TextView>(R.id.componentCategory).text = "НЕ НАЙДЕНО"
                        row.findViewById<TextView>(R.id.componentName).text = "id $id"
                        row.findViewById<TextView>(R.id.componentPrice).text = "—"
                        container.addView(row)
                    }
                }
            }

            totalTv.text = priceStr(sumRub)

            val budgetParsed = parseBudgetHintFromDescription(s.description)
            if (budgetParsed != null && budgetParsed > 0) {
                budgetHint.visibility = View.VISIBLE
                budgetHint.text = "В пределах бюджета до ${priceStr(budgetParsed)}"
            }

            extractSubtitleFromSuggestionDescription(s.description)?.let { sub ->
                subtitleTv.visibility = View.VISIBLE
                subtitleTv.text = sub
            }

            runOnUiThread {
                MaterialAlertDialogBuilder(this)
                    .setTitle(s.name)
                    .setView(content)
                    .setPositiveButton("Сохранить сборку") { _, _ -> onAddSuggestionToBuilds(s) }
                    .setNegativeButton("Закрыть", null)
                    .show()
            }
        }.start()
    }

    private fun onAddSuggestionToBuilds(suggestion: BuildsApi.BuildSuggestion) {
        val token = sessionManager.token
        if (token.isNullOrBlank()) {
            Snackbar.make(findViewById(android.R.id.content), "Войдите в аккаунт, чтобы сохранить сборку", Snackbar.LENGTH_LONG).show()
            showPageById(R.id.action_profile)
            return
        }
        Thread {
            val r = BuildsApi.createBuildFromSuggestion(token, suggestion.name, suggestion.componentIds)
            runOnUiThread {
                when (r) {
                    is BuildsApi.ApiResult.Success -> {
                        Snackbar.make(findViewById(android.R.id.content), "Сборка «${suggestion.name}» добавлена", Snackbar.LENGTH_SHORT).show()
                        showPageById(R.id.navigation_build)
                        refreshBuildList?.invoke()
                        refreshHomeBuildsCard?.invoke()
                    }
                    is BuildsApi.ApiResult.Error -> {
                        Snackbar.make(findViewById(android.R.id.content), r.message, Snackbar.LENGTH_LONG).show()
                    }
                }
            }
        }.start()
    }

    private fun scrollToBottomOfMessages() {
        messagesScrollView.post {
            messagesScrollView.fullScroll(ScrollView.FOCUS_DOWN)
        }
    }

    /** Убирает хвосты «(копия)» / «(копия N)», чтобы новая копия называлась «Имя (копия 2)», «(копия 3)», … */
    private fun stemBuildNameForCopy(name: String): String {
        var s = name.trim()
        val rx = Regex("""(?:\s*\(копия(?:\s+\d+)?\)\s*)+$""", RegexOption.IGNORE_CASE)
        s = s.replace(rx, "").trim()
        return s.ifBlank { name.trim() }
    }

    fun onCategoryClick(view: View) {
        // Здесь будет обработка клика по категории
    }
}