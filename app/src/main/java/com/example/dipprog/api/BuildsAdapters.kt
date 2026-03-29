package com.example.dipprog.api

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.example.dipprog.R
import com.google.android.material.button.MaterialButton

fun priceStr(price: Any?): String {
    if (price == null) return "—"
    val n = (price as? Number)?.toDouble() ?: (price.toString().toDoubleOrNull() ?: 0.0)
    return "%,.0f ₽".format(n)
}

class BuildsAdapter(
    private var items: List<BuildsApi.Build>,
    private val onBuildClick: (BuildsApi.Build) -> Unit
) : RecyclerView.Adapter<BuildsAdapter.VH>() {
    class VH(v: View) : RecyclerView.ViewHolder(v) {
        val name: TextView = v.findViewById(R.id.itemBuildName)
        val date: TextView = v.findViewById(R.id.itemBuildDate)
    }
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
        VH(LayoutInflater.from(parent.context).inflate(R.layout.item_build, parent, false))
    override fun onBindViewHolder(holder: VH, position: Int) {
        val b = items[position]
        holder.name.text = b.name
        holder.date.text = b.created_at?.take(10) ?: ""
        holder.itemView.setOnClickListener { onBuildClick(b) }
    }
    override fun getItemCount(): Int = items.size
    fun setData(list: List<BuildsApi.Build>) {
        items = list
        notifyDataSetChanged()
    }
}

class BuildComponentsAdapter(
    private var items: List<BuildsApi.BuildComponent>,
    private val onRemove: (BuildsApi.BuildComponent) -> Unit,
    private val onComponentClick: ((BuildsApi.BuildComponent) -> Unit)? = null
) : RecyclerView.Adapter<BuildComponentsAdapter.VH>() {
    class VH(v: View) : RecyclerView.ViewHolder(v) {
        val name: TextView = v.findViewById(R.id.itemBuildCompName)
        val price: TextView = v.findViewById(R.id.itemBuildCompPrice)
        val qty: TextView = v.findViewById(R.id.itemBuildCompQty)
        val remove: MaterialButton = v.findViewById(R.id.itemBuildCompRemove)
    }
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
        VH(LayoutInflater.from(parent.context).inflate(R.layout.item_build_component, parent, false))
    override fun onBindViewHolder(holder: VH, position: Int) {
        val c = items[position]
        holder.name.text = c.name
        holder.price.text = priceStr(c.price)
        holder.qty.text = "×${c.quantity}"
        holder.itemView.setOnClickListener { onComponentClick?.invoke(c) }
        holder.remove.setOnClickListener { onRemove(c) }
    }
    override fun getItemCount(): Int = items.size
    fun setData(list: List<BuildsApi.BuildComponent>) {
        items = list
        notifyDataSetChanged()
    }
}

class ComponentsAdapter(
    private var items: List<BuildsApi.Component>,
    private val onAddToBuild: (BuildsApi.Component) -> Unit,
    private val onAddToCart: (BuildsApi.Component) -> Unit
) : RecyclerView.Adapter<ComponentsAdapter.VH>() {
    class VH(v: View) : RecyclerView.ViewHolder(v) {
        val name: TextView = v.findViewById(R.id.itemComponentName)
        val price: TextView = v.findViewById(R.id.itemComponentPrice)
        val addBuild: MaterialButton = v.findViewById(R.id.itemComponentAddBuild)
        val addCart: MaterialButton = v.findViewById(R.id.itemComponentAddCart)
    }
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
        VH(LayoutInflater.from(parent.context).inflate(R.layout.item_component, parent, false))
    override fun onBindViewHolder(holder: VH, position: Int) {
        val c = items[position]
        holder.name.text = c.name
        holder.price.text = priceStr(c.price)
        holder.addBuild.setOnClickListener { onAddToBuild(c) }
        holder.addCart.setOnClickListener { onAddToCart(c) }
    }
    override fun getItemCount(): Int = items.size
    fun setData(list: List<BuildsApi.Component>) {
        items = list
        notifyDataSetChanged()
    }
}

class CartAdapter(
    private var items: List<BuildsApi.CartItem>,
    private val onRemove: (BuildsApi.CartItem) -> Unit
) : RecyclerView.Adapter<CartAdapter.VH>() {
    class VH(v: View) : RecyclerView.ViewHolder(v) {
        val name: TextView = v.findViewById(R.id.itemCartName)
        val price: TextView = v.findViewById(R.id.itemCartPrice)
        val qty: TextView = v.findViewById(R.id.itemCartQty)
        val remove: MaterialButton = v.findViewById(R.id.itemCartRemove)
    }
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
        VH(LayoutInflater.from(parent.context).inflate(R.layout.item_cart, parent, false))
    override fun onBindViewHolder(holder: VH, position: Int) {
        val c = items[position]
        holder.name.text = c.name
        holder.price.text = priceStr(c.price)
        holder.qty.text = "×${c.quantity}"
        holder.remove.setOnClickListener { onRemove(c) }
    }
    override fun getItemCount(): Int = items.size
    fun setData(list: List<BuildsApi.CartItem>) {
        items = list
        notifyDataSetChanged()
    }
}
