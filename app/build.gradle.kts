import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

val localProperties = Properties().apply {
    rootProject.file("local.properties").takeIf { it.exists() }?.reader(Charsets.UTF_8)?.use { load(it) }
}
val apiBaseUrl = localProperties.getProperty("api.base.url", "http://10.0.2.2:3000")
    .trim().trimEnd('/')

android {
    namespace = "com.example.dipprog"
    compileSdk = 34

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        applicationId = "com.example.dipprog"
        minSdk = 24
        targetSdk = 34
        versionCode = 3
        versionName = "0.2.1"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // URL сервера: по умолчанию эмулятор. Для реального устройства задайте api.base.url в local.properties
        buildConfigField("String", "BASE_URL", "\"$apiBaseUrl\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.constraintlayout)
    implementation(libs.androidx.recyclerview)
    implementation(libs.androidx.viewpager2)
    implementation(libs.okhttp)
    implementation(libs.gson)
    implementation(libs.coil)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.kotlinx.coroutines.android)
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation(libs.androidx.work.runtime.ktx)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}